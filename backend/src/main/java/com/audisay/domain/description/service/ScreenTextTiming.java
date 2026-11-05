package com.audisay.domain.description.service;

import com.audisay.domain.description.service.SceneText.Moment;
import com.audisay.domain.description.service.SceneText.MomentType;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * 화면 글자가 나온 시각 추정. AI(describe.py)가 화면 글자에 글자가 나온 시각이 아니라 장면의 시작·끝을 넣어서,
 * 해설·대사가 그 글자를 읽은 시각으로 본다: 같은 장면에서 두 글자 묶음이 가장 많이 겹치는 해설·대사 줄
 * (그 줄 묶음의 25% 이상, 3개 이상). 그런 줄이 없으면 null(언제 나왔는지 모름)
 */
public final class ScreenTextTiming {
    static final double MIN_OVERLAP = 0.25;
    static final int MIN_SHARED = 3;

    private ScreenTextTiming() {
    }

    public record Line(int startMs, String text) {
    }

    /** [fromMs, toMs) 안에서 시작하는 줄에서 찾는다 */
    public static Integer estimate(String screenText, int fromMs, int toMs, List<Line> lines) {
        Set<String> screen = grams(screenText);
        if (screen.isEmpty()) {
            return null;
        }
        Integer best = null;
        double bestScore = 0;
        for (Line line : lines) {
            if (line.startMs() < fromMs || line.startMs() >= toMs) {
                continue;
            }
            Set<String> other = grams(line.text());
            int shared = 0;
            for (String gram : other) {
                if (screen.contains(gram)) {
                    shared++;
                }
            }
            double score = other.isEmpty() ? 0 : (double) shared / other.size();
            if (shared >= MIN_SHARED && score >= MIN_OVERLAP && score > bestScore) {
                best = line.startMs();
                bestScore = score;
            }
        }
        return best;
    }

    /** 장면 찾기용 장면의 화면 글자를 추정 시각으로 옮긴다(못 찾으면 그대로) */
    public static SceneText retime(SceneText scene) {
        List<Line> spoken = scene.moments().stream()
                .filter(m -> m.type() != MomentType.SCREEN)
                .map(m -> new Line(m.startMs(), m.text()))
                .toList();
        List<Moment> moments = new ArrayList<>();
        boolean moved = false;
        for (Moment moment : scene.moments()) {
            Integer at = moment.type() == MomentType.SCREEN
                    ? estimate(moment.text(), moment.startMs(), scene.endMs(), spoken) : null;
            if (at != null && at != moment.startMs()) {
                moments.add(new Moment(at, moment.type(), moment.text()));
                moved = true;
            } else {
                moments.add(moment);
            }
        }
        if (!moved) {
            return scene;
        }
        moments.sort(Comparator.comparingInt(Moment::startMs));
        return new SceneText(scene.chapterId(), scene.chapterIndex(), scene.startMs(), scene.endMs(), scene.title(),
                scene.summary(), scene.keywords(), scene.sceneDescription(), moments);
    }

    static Set<String> grams(String text) {
        Set<String> grams = new HashSet<>();
        if (text == null) {
            return grams;
        }
        String t = text.toLowerCase(Locale.ROOT).replaceAll("[^0-9a-z가-힣]", "");
        for (int i = 0; i + 1 < t.length(); i++) {
            grams.add(t.substring(i, i + 2));
        }
        return grams;
    }
}
