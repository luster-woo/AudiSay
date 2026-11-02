package com.audisay.global.external.llm;

/**
 * @param outputTokens 추론(thinking) 토큰 포함
 * @param cancelled    스트리밍 중 호출한 쪽이 멈췄으면 true(text는 받은 데까지)
 * @param callLogId    남긴 ai_call_logs 행 ID(기록 실패면 null)
 */
public record LlmResult(String text, String model, int inputTokens, int outputTokens, long latencyMs,
                        boolean cancelled, Long callLogId) {

    public LlmResult withCallLogId(Long callLogId) {
        return new LlmResult(text, model, inputTokens, outputTokens, latencyMs, cancelled, callLogId);
    }
}
