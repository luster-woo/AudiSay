package com.audisay.global.external.llm;

/**
 * @param jsonOutput true면 JSON으로만 답하게 한다(분류·장면 찾기)
 * @param chatLogId  ai_call_logs.chat_log_id에 연결할 챗봇 기록(없으면 null)
 * @param noFallback true면 주 모델이 실패해도 대체 모델을 부르지 않는다(시간 예산이 빠듯한 덤 호출)
 * @param fallbackDeadlineNanos 이 System.nanoTime()까지 대체 모델 한 번(시간 제한)을 다 기다릴 수 없으면 대체하지 않는다(null이면 제한 없음)
 */
public record LlmRequest(LlmPurpose purpose, String system, String user, boolean jsonOutput,
                         int maxOutputTokens, double temperature, Long chatLogId, boolean noFallback,
                         Long fallbackDeadlineNanos) {

    public static LlmRequest json(LlmPurpose purpose, String system, String user, int maxOutputTokens) {
        return new LlmRequest(purpose, system, user, true, maxOutputTokens, 0, null, false, null);
    }

    public static LlmRequest text(LlmPurpose purpose, String system, String user, int maxOutputTokens) {
        return new LlmRequest(purpose, system, user, false, maxOutputTokens, 0.2, null, false, null);
    }

    public LlmRequest withChatLogId(Long chatLogId) {
        return new LlmRequest(purpose, system, user, jsonOutput, maxOutputTokens, temperature, chatLogId, noFallback,
                fallbackDeadlineNanos);
    }

    public LlmRequest withoutFallback() {
        return new LlmRequest(purpose, system, user, jsonOutput, maxOutputTokens, temperature, chatLogId, true,
                fallbackDeadlineNanos);
    }

    public LlmRequest withFallbackDeadline(Long deadlineNanos) {
        return new LlmRequest(purpose, system, user, jsonOutput, maxOutputTokens, temperature, chatLogId, noFallback,
                deadlineNanos);
    }
}
