package com.audisay.global.external.llm.claude;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.stream.Collectors;

/** Messages API 응답 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record ClaudeResponse(List<Block> content, @JsonProperty("stop_reason") String stopReason, Usage usage) {

    public String text() {
        if (content == null) {
            return "";
        }
        return content.stream()
                .filter(block -> "text".equals(block.type()) && block.text() != null)
                .map(Block::text)
                .collect(Collectors.joining());
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Block(String type, String text) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Usage(@JsonProperty("input_tokens") Integer inputTokens,
                        @JsonProperty("output_tokens") Integer outputTokens) {

        public int input() {
            return inputTokens == null ? 0 : inputTokens;
        }

        public int output() {
            return outputTokens == null ? 0 : outputTokens;
        }
    }
}
