package com.audisay.domain.chat.dto.response;

/**
 * @param latencyMs Spring이 요청을 받아 AI 서버 응답을 받을 때까지 걸린 시간
 */
public record SttResponse(String text, long latencyMs) {
}
