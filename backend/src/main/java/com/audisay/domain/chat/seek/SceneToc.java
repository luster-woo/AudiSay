package com.audisay.domain.chat.seek;

import com.audisay.domain.description.service.SceneText;
import com.audisay.domain.description.service.SceneText.Moment;

import java.util.List;
import java.util.stream.Collectors;

/**
 * LLM에 보낼 장면 목차. 장면마다 "번호. 시작 시각 제목 / 요약 / 키워드 / 발췌" 한 줄.
 * 발췌는 장면 설명 → 해설 문장 → 대사 → 화면 글자 순으로 이어 붙여 자른다. 목차가 많으면 장면당 발췌를 줄여 전체를 약 12,000자로
 */
final class SceneToc {
    static final int MAX_TOTAL_EXCERPT = 12_000;
    static final int MAX_EXCERPT = 200;
    static final int MIN_EXCERPT = 60;

    private SceneToc() {
    }

    static String build(List<SceneText> scenes) {
        int perScene = Math.max(MIN_EXCERPT, Math.min(MAX_EXCERPT, MAX_TOTAL_EXCERPT / Math.max(1, scenes.size())));
        StringBuilder toc = new StringBuilder();
        for (int i = 0; i < scenes.size(); i++) {
            SceneText scene = scenes.get(i);
            toc.append(i + 1).append(". ").append(clock(scene.startMs())).append(' ').append(scene.title());
            if (scene.summary() != null && !scene.summary().isBlank()) {
                toc.append(" / ").append(scene.summary());
            }
            if (!scene.keywords().isEmpty()) {
                toc.append(" / ").append(String.join(", ", scene.keywords()));
            }
            String excerpt = excerpt(scene, perScene);
            if (!excerpt.isEmpty()) {
                toc.append(" / 발췌: ").append(excerpt);
            }
            toc.append('\n');
        }
        return toc.toString();
    }

    static String excerpt(SceneText scene, int limit) {
        String moments = scene.moments().stream()
                .sorted((a, b) -> Integer.compare(a.type().ordinal(), b.type().ordinal()))
                .map(Moment::text)
                .collect(Collectors.joining(" "));
        String text = ((scene.sceneDescription() == null ? "" : scene.sceneDescription()) + " " + moments)
                .replaceAll("\\s+", " ").strip();
        return text.length() <= limit ? text : text.substring(0, limit) + "…";
    }

    /** 125000 → "2:05", 3725000 → "1:02:05" */
    static String clock(int ms) {
        int total = ms / 1000;
        int h = total / 3600;
        int m = total % 3600 / 60;
        int s = total % 60;
        return h > 0 ? String.format("%d:%02d:%02d", h, m, s) : String.format("%d:%02d", m, s);
    }
}
