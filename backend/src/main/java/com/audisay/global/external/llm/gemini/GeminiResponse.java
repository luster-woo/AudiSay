package com.audisay.global.external.llm.gemini;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/** generateContent 응답, 또는 스트리밍 SSE 조각 하나 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record GeminiResponse(List<Candidate> candidates, PromptFeedback promptFeedback, UsageMetadata usageMetadata) {
    private static final Set<String> BLOCKED_FINISH = Set.of("SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII");

    /** 추론(thought) 조각을 뺀 글 */
    public String text() {
        if (candidates == null || candidates.isEmpty() || candidates.get(0).content() == null
                || candidates.get(0).content().parts() == null) {
            return "";
        }
        return candidates.get(0).content().parts().stream()
                .filter(part -> !Boolean.TRUE.equals(part.thought()) && part.text() != null)
                .map(Part::text)
                .collect(Collectors.joining());
    }

    /** 안전 정책으로 막혔으면 이유, 아니면 null */
    public String blockReason() {
        if (promptFeedback != null && promptFeedback.blockReason() != null) {
            return promptFeedback.blockReason();
        }
        String finishReason = candidates == null || candidates.isEmpty() ? null : candidates.get(0).finishReason();
        if (finishReason != null && BLOCKED_FINISH.contains(finishReason)) {
            return finishReason;
        }
        return null;
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Candidate(Content content, String finishReason) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Content(List<Part> parts) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Part(String text, Boolean thought) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record PromptFeedback(String blockReason) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UsageMetadata(Integer promptTokenCount, Integer candidatesTokenCount, Integer thoughtsTokenCount) {

        public int input() {
            return promptTokenCount == null ? 0 : promptTokenCount;
        }

        /** 추론 토큰도 출력 단가로 차감된다 */
        public int output() {
            return (candidatesTokenCount == null ? 0 : candidatesTokenCount)
                    + (thoughtsTokenCount == null ? 0 : thoughtsTokenCount);
        }
    }
}
