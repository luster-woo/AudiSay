package com.audisay.domain.description.service;

import java.util.List;

/**
 * 챗봇 답변(QUESTION·SCENE_NOW)에 넘기는 저장 자료. 입력 시각까지만 담는다(뒤 대사·문장은 스포일러라 넣지 않음, 장면 설명은 장면 전체)
 *
 * @param scenes 앞 장면, 지금 장면 순(입력 시각이 첫 장면보다 앞이면 첫 장면 하나)
 */
public record AnswerContext(String videoTitle, String summary, int nowMs, List<SceneInfo> scenes,
                            List<Dialogue> recentDialogues, List<Person> characters) {

    /** 지금 장면(없으면 null) */
    public SceneInfo currentScene() {
        return scenes.isEmpty() ? null : scenes.get(scenes.size() - 1);
    }

    /**
     * @param title      바로 하는 답(answer-past-only)이면 끝나지 않은 장면은 null
     * @param narrations 이 장면에서 입력 시각까지 나온 해설 문장(v1~v3, 시간순)
     */
    public record SceneInfo(int startMs, String title, String description, List<Narration> narrations,
                            List<String> screenTexts) {
    }

    /** 시각을 같이 넘겨 LLM이 입력 시각과 가까운 문장을 직접 고르게 한다 */
    public record Narration(int startMs, String text) {
    }

    public record Dialogue(int startMs, String speaker, String text) {
    }

    public record Person(String name, String appearance) {
    }
}
