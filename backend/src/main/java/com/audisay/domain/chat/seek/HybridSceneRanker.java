package com.audisay.domain.chat.seek;

import com.audisay.domain.chat.search.VectorLine;
import com.audisay.domain.chat.seek.KeywordSceneScorer.Hit;
import com.audisay.domain.description.service.SceneText;
import com.audisay.domain.description.service.SceneText.Moment;
import com.audisay.domain.description.service.SceneText.MomentType;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;

/**
 * 키워드 후보와 벡터 검색 후보를 RRF(1 / (60 + 순위))로 합친다. 이동 시각이 10초 안이면 같은 후보로 묶고, 벡터 후보가 있으면 그것을 대표로 둔다
 * (키워드 후보는 15초 안 후보를 가장 이른 시각 하나로 합친 것이라, 특정 줄을 가리키는 벡터 후보가 더 정확하다).
 * 벡터 후보는 그 줄이 속한 장면의 Moment로 바꿔 LlmHitVerifier가 앞뒤 문장을 붙일 수 있게 한다.
 * 장면 시작을 가리키는 후보(장면 설명·목차로 찾음)는 그 장면 안에서 벡터 검색이 가장 비슷하다고 본 줄로 옮긴다(검색 단위와 이동 단위를 나눔).
 */
final class HybridSceneRanker {
    static final int RRF_K = 60;
    static final int MERGE_MS = 10_000;
    static final int KEYWORD_TOP = 20;

    private HybridSceneRanker() {
    }

    static List<Hit> fuse(List<Hit> keywordHits, List<VectorLine> lines, List<SceneText> scenes, int limit) {
        List<Hit> byKeyword = dedupe(keywordHits.stream()
                .sorted(Comparator.comparingDouble(Hit::score).reversed())
                .limit(KEYWORD_TOP)
                .toList());
        List<Hit> byVector = dedupe(lines.stream().map(line -> toHit(line, scenes)).filter(Objects::nonNull).toList());
        List<Candidate> candidates = new ArrayList<>();
        add(candidates, byKeyword, false);
        add(candidates, byVector, true);
        List<Hit> ranked = candidates.stream()
                .sorted(Comparator.comparingDouble(Candidate::score).reversed())
                .map(c -> refine(c.hit(), lines, scenes))
                .toList();
        return dedupe(ranked).stream().limit(limit).toList();
    }

    /** 장면 시작을 가리키는 후보면 그 장면 안에서 가장 비슷한 줄(장면 설명 제외)로. 그런 줄이 없으면 그대로 */
    static Hit refine(Hit hit, List<VectorLine> lines, List<SceneText> scenes) {
        if (hit.moment() != null) {
            return hit;
        }
        SceneText scene = hit.scene();
        return lines.stream()
                .filter(line -> !"SCENE".equals(line.sourceType()))
                .filter(line -> line.startMs() >= scene.startMs() && line.startMs() < scene.endMs())
                .findFirst()
                .map(line -> toHit(line, scenes))
                .orElse(hit);
    }

    static Hit toHit(VectorLine line, List<SceneText> scenes) {
        SceneText scene = null;
        for (SceneText candidate : scenes) {
            if (candidate.startMs() <= line.startMs()) {
                scene = candidate;
            }
        }
        if (scene == null) {
            if (scenes.isEmpty()) {
                return null;
            }
            scene = scenes.get(0);
        }
        if ("SCENE".equals(line.sourceType())) {
            return new Hit(scene, scene.startMs(), line.similarity(), 0, null, line.text(), 1);
        }
        MomentType type = MomentType.valueOf(line.sourceType());
        Moment moment = scene.moments().stream()
                .filter(m -> m.startMs() == line.startMs() && m.type() == type && m.text().equals(line.text()))
                .findFirst()
                .orElse(new Moment(line.startMs(), type, line.text()));
        int target = Math.max(scene.startMs(), line.startMs() - KeywordSceneScorer.LEAD_MS);
        return new Hit(scene, target, line.similarity(), 0, moment, line.text(), 1);
    }

    private static List<Hit> dedupe(List<Hit> ranked) {
        List<Hit> kept = new ArrayList<>();
        for (Hit hit : ranked) {
            if (kept.stream().noneMatch(k -> Math.abs(k.targetMs() - hit.targetMs()) <= MERGE_MS)) {
                kept.add(hit);
            }
        }
        return kept;
    }

    private static void add(List<Candidate> candidates, List<Hit> ranked, boolean fromVector) {
        for (int rank = 0; rank < ranked.size(); rank++) {
            Hit hit = ranked.get(rank);
            double score = 1.0 / (RRF_K + rank + 1);
            Candidate same = candidates.stream()
                    .filter(c -> Math.abs(c.hit.targetMs() - hit.targetMs()) <= MERGE_MS)
                    .findFirst()
                    .orElse(null);
            if (same == null) {
                candidates.add(new Candidate(hit, score, fromVector));
            } else {
                same.score += score;
                if (fromVector && !same.fromVector) {
                    same.hit = hit;
                    same.fromVector = true;
                }
            }
        }
    }

    private static final class Candidate {
        private Hit hit;
        private double score;
        private boolean fromVector;

        private Candidate(Hit hit, double score, boolean fromVector) {
            this.hit = hit;
            this.score = score;
            this.fromVector = fromVector;
        }

        Hit hit() {
            return hit;
        }

        double score() {
            return score;
        }
    }
}
