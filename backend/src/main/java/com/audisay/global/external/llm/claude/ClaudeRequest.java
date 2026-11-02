package com.audisay.global.external.llm.claude;

import com.audisay.global.external.llm.LlmRequest;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Messages API 요청 본문. haiku 5.5는 기본으로 추론해서 꺼야 하고, 추론을 끄면 temperature를 거부해 보내지 않는다(11-02 실측).
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ClaudeRequest(String model, @JsonProperty("max_tokens") int maxTokens, String system,
                            List<Message> messages, Thinking thinking, Boolean stream) {

    public static ClaudeRequest of(LlmRequest request, String model, boolean stream) {
        return new ClaudeRequest(model, request.maxOutputTokens(), request.system(),
                List.of(new Message("user", request.user())), new Thinking("disabled"), stream ? Boolean.TRUE : null);
    }

    public record Message(String role, String content) {
    }

    public record Thinking(String type) {
    }
}
