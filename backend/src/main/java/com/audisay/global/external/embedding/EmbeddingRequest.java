package com.audisay.global.external.embedding;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;

/** OpenAI 형식 /v1/embeddings 요청 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record EmbeddingRequest(String model, List<String> input, Integer dimensions) {
}
