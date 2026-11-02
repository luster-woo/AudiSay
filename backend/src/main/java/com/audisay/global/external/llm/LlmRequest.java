package com.audisay.global.external.llm;

/**
 * @param jsonOutput true면 JSON으로만 답하게 한다(분류·장면 찾기)
 * @param chatLogId  ai_call_logs.chat_log_id에 연결할 챗봇 기록(없으면 null)
 */
public record LlmRequest(LlmPurpose purpose, String system, String user, boolean jsonOutput,
                         int maxOutputTokens, double temperature, Long chatLogId) {

    public static LlmRequest json(LlmPurpose purpose, String system, String user, int maxOutputTokens) {
        return new LlmRequest(purpose, system, user, true, maxOutputTokens, 0, null);
    }

    public static LlmRequest text(LlmPurpose purpose, String system, String user, int maxOutputTokens) {
        return new LlmRequest(purpose, system, user, false, maxOutputTokens, 0.2, null);
    }

    public LlmRequest withChatLogId(Long chatLogId) {
        return new LlmRequest(purpose, system, user, jsonOutput, maxOutputTokens, temperature, chatLogId);
    }
}
