package com.audisay.global.external.embedding;

import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Locale;

/**
 * audisay.gms.mode=mock: GMS를 부르지 않고 글자 2-gram을 차원에 흩어 담은 벡터를 준다(크레딧 0, 기록 없음).
 * 글자가 겹치는 글끼리 비슷해서 로컬에서 검색 흐름을 확인할 수 있다.
 */
@Slf4j
@Component
@ConditionalOnProperty(prefix = "audisay.gms", name = "mode", havingValue = "mock")
public class FakeEmbeddingClient implements EmbeddingClient {
    private final int dimensions;

    public FakeEmbeddingClient(EmbeddingProperties properties) {
        this.dimensions = properties.dimensions();
        log.warn("[EMBED] GMS mock 모드입니다. 임베딩을 부르지 않고 가짜 벡터를 줍니다 (audisay.gms.mode=mock)");
    }

    @Override
    public List<float[]> embedDocuments(List<String> texts, Long jobId) {
        return texts.stream().map(this::vector).toList();
    }

    @Override
    public float[] embedQuery(String text, Long chatLogId) {
        return vector(text);
    }

    @Override
    public String model() {
        return "mock";
    }

    float[] vector(String text) {
        float[] vector = new float[dimensions];
        String compact = text == null ? "" : text.replaceAll("\\s+", "").toLowerCase(Locale.ROOT);
        for (int i = 0; i + 1 < compact.length(); i++) {
            vector[Math.floorMod(compact.substring(i, i + 2).hashCode(), dimensions)] += 1;
        }
        double norm = 0;
        for (float v : vector) {
            norm += v * v;
        }
        if (norm == 0) {
            vector[0] = 1;
            return vector;
        }
        float scale = (float) (1 / Math.sqrt(norm));
        for (int i = 0; i < dimensions; i++) {
            vector[i] *= scale;
        }
        return vector;
    }
}
