package com.audisay.global.external.embedding;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * 장면 검색 임베딩(GMS OpenAI 형식) 설정 (application.yml의 audisay.embedding).
 * 키·연결 시간·서킷 브레이커·단가는 audisay.gms 값을 같이 쓴다. dimensions는 V7 `vector(1536)`과 같아야 한다.
 *
 * @param batchSize       요청 한 번에 넣는 글 수
 * @param queryTimeout    장면 찾기 질문 하나(늦으면 호출한 쪽이 키워드 방식으로)
 * @param documentTimeout 색인 요청 하나
 */
@ConfigurationProperties("audisay.embedding")
public record EmbeddingProperties(String baseUrl, String model, Integer dimensions, Integer batchSize,
                                  Duration queryTimeout, Duration documentTimeout) {

    public EmbeddingProperties {
        baseUrl = baseUrl == null || baseUrl.isBlank() ? "https://gms.ssafy.io/gmsapi/api.openai.com" : baseUrl;
        model = model == null || model.isBlank() ? "text-embedding-3-large" : model;
        dimensions = dimensions == null ? 1536 : dimensions;
        batchSize = batchSize == null ? 100 : batchSize;
        queryTimeout = queryTimeout == null ? Duration.ofSeconds(3) : queryTimeout;
        documentTimeout = documentTimeout == null ? Duration.ofSeconds(30) : documentTimeout;
    }
}
