package com.audisay.global.external.llm.claude;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 스트리밍 이벤트 하나(data 줄). message_start(입력 토큰) → content_block_delta(글 조각) → message_delta(출력 토큰·멈춘 이유)
 * → message_stop. 실패는 error 이벤트로 온다.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record ClaudeEvent(String type, Message message, Delta delta, ClaudeResponse.Usage usage, ErrorBody error) {

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Message(ClaudeResponse.Usage usage) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Delta(String type, String text, @JsonProperty("stop_reason") String stopReason) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ErrorBody(String type, String message) {
    }
}
