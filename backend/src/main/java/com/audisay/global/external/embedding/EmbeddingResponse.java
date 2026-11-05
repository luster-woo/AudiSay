package com.audisay.global.external.embedding;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/** OpenAI 형식 /v1/embeddings 응답. data는 index 순서가 보장되지 않아 index로 맞춘다 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record EmbeddingResponse(List<Item> data, Usage usage) {

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Item(int index, float[] embedding) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Usage(@JsonProperty("prompt_tokens") Integer promptTokens) {

        public int tokens() {
            return promptTokens == null ? 0 : promptTokens;
        }
    }
}
