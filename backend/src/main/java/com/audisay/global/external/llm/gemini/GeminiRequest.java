package com.audisay.global.external.llm.gemini;

import com.audisay.global.external.llm.LlmRequest;
import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;

/** generateContent·streamGenerateContent 요청 본문 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record GeminiRequest(Content systemInstruction, List<Content> contents, GenerationConfig generationConfig) {

    public static GeminiRequest of(LlmRequest request, Integer thinkingBudget) {
        Content system = request.system() == null ? null : new Content(null, List.of(new Part(request.system())));
        GenerationConfig config = new GenerationConfig(
                request.temperature(),
                request.maxOutputTokens(),
                request.jsonOutput() ? "application/json" : null,
                thinkingBudget == null ? null : new ThinkingConfig(thinkingBudget));
        return new GeminiRequest(system, List.of(new Content("user", List.of(new Part(request.user())))), config);
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

    public record ThinkingConfig(Integer thinkingBudget) {
    }
}
