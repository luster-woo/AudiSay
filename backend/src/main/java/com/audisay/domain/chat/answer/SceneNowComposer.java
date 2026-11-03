package com.audisay.domain.chat.answer;

import com.audisay.domain.description.service.AnswerContext;
import com.audisay.domain.description.service.AnswerContext.SceneInfo;

import java.util.ArrayList;
import java.util.List;

/**
 * SCENE_NOW("지금 뭐가 나와?") 저장 자료 문장. 답은 제목을 먼저 읽고(AI 없이) LLM이 지금 화면을 1~2문장으로 잇는다.
 * LLM 장애·한도·시간 초과면 에러 대신 장면 설명으로 답한다
 */
public final class SceneNowComposer {
    static final int MAX_SENTENCES = 2;
    public static final String NO_SCENE = "이 시각의 장면 설명이 없어요.";

    private SceneNowComposer() {
    }

    /** 첫 문장(장면이 없으면 null → 바로 LLM) */
    public static String title(AnswerContext context) {
        SceneInfo scene = context.currentScene();
        return scene == null ? null : AnswerPrompt.sceneTitleSentence(scene);
    }

    /** LLM을 못 쓸 때 제목 뒤에 읽을 장면 설명. 장면도 설명도 없으면 안내 한 문장 */
    public static List<String> fallback(AnswerContext context) {
        SceneInfo scene = context.currentScene();
        List<String> sentences = new ArrayList<>(
                scene == null ? List.of() : AnswerPrompt.sentencesOf(scene.description(), MAX_SENTENCES));
        if (sentences.isEmpty()) {
            sentences.add(NO_SCENE);
        }
        return sentences;
    }
}
