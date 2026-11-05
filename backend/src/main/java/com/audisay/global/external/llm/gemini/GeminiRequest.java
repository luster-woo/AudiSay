package com.audisay.global.external.llm.gemini;

import com.audisay.global.external.llm.LlmRequest;
import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;

/** generateContent·streamGenerateContent 요청 본문 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record GeminiRequest(Content systemInstruction, List<Content> contents, GenerationConfig generationConfig) {

    /** thinkingLevel이 있으면 그것만(추론을 끌 수 없는 모델), 없으면 thinkingBudget */
    public static GeminiRequest of(LlmRequest request, Integer thinkingBudget, String thinkingLevel) {
        Content system = request.system() == null ? null : new Content(null, List.of(new Part(request.system())));
        GenerationConfig config = new GenerationConfig(
                request.temperature(),
                request.maxOutputTokens(),
                request.jsonOutput() ? "application/json" : null,
                thinking(thinkingBudget, thinkingLevel));
        return new GeminiRequest(system, List.of(new Content("user", List.of(new Part(request.user())))), config);
    }

    private static ThinkingConfig thinking(Integer thinkingBudget, String thinkingLevel) {
        if (thinkingLevel != null) {
            return new ThinkingConfig(null, thinkingLevel);
        }
        return thinkingBudget == null ? null : new ThinkingConfig(thinkingBudget, null);
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Content(String role, List<Part> parts) {
    }

    public record Part(String text) {
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record GenerationConfig(Double temperature, Integer maxOutputTokens, String responseMimeType,
                                   ThinkingConfig thinkingConfig) {
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ThinkingConfig(Integer thinkingBudget, String thinkingLevel) {
    }
}
