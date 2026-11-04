package com.audisay.domain.chat.dto.response;

import com.audisay.domain.chat.entity.AnswerSource;

/** 답변 SSE 이벤트 data. 이벤트 이름은 delta / sentence / done / error(Failed) */
public final class AnswerStreamEvent {

    private AnswerStreamEvent() {
    }

    /** 글자 조각(화면 표시용) */
    public record Delta(String text) {
    }

    /** 끝난 문장과 그 음성(만들지 못하면 audioUrl null → 브라우저 음성) */
    public record Sentence(String text, String audioUrl) {
    }

    /** @param futureAvailable 바로 답하지 못했지만 지금 이후 내용에 답이 있음 → FE가 "들으시겠어요?"를 받고 includeFuture=true로 재구독 */
    public record Done(String answerText, AnswerSource answerSource, Integer firstAudioMs, Integer totalLatencyMs,
                       boolean futureAvailable) {
    }

    /** errorCode: AI_TIMEOUT / AI_LIMIT / AI_UNAVAILABLE / UNKNOWN */
    public record Failed(String errorCode, String message) {
    }
}
