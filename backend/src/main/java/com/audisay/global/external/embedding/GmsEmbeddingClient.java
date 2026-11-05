package com.audisay.global.external.embedding;

import com.audisay.global.aicall.AiCallLog;
import com.audisay.global.aicall.AiCallRecorder;
import com.audisay.global.external.llm.GmsProperties;
import com.audisay.global.external.llm.LlmException;
import com.audisay.global.external.llm.LlmException.Kind;
import io.github.resilience4j.circuitbreaker.CallNotPermittedException;
import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import io.github.resilience4j.circuitbreaker.CircuitBreakerConfig;
import io.github.resilience4j.circuitbreaker.CircuitBreakerRegistry;
import io.github.resilience4j.micrometer.tagged.TaggedCircuitBreakerMetrics;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import tools.jackson.databind.ObjectMapper;

import java.net.http.HttpClient;
import java.net.http.HttpConnectTimeoutException;
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * GMS를 거쳐 OpenAI 형식 /v1/embeddings를 부른다. 색인은 batchSize개씩 나눠 보내고, 요청마다 ai_call_logs(EMBED)에 남긴다.
 * 서킷 브레이커는 장애·시간 초과만 실패로 센다(LLM과 같은 기준). 열려 있으면 바로 UNAVAILABLE.
 */
@Slf4j
@Component
@ConditionalOnProperty(prefix = "audisay.gms", name = "mode", havingValue = "real", matchIfMissing = true)
public class GmsEmbeddingClient implements EmbeddingClient {
    static final String CIRCUIT_OPEN = "CIRCUIT_OPEN";
    private static final int MAX_ERROR_BODY = 300;

    private final EmbeddingProperties properties;
    private final GmsProperties gms;
    private final ObjectMapper objectMapper;
    private final AiCallRecorder recorder;
    private final MeterRegistry meterRegistry;
    private final RestClient queryClient;
    private final RestClient documentClient;
    private final CircuitBreaker breaker;

    public GmsEmbeddingClient(EmbeddingProperties properties, GmsProperties gms, ObjectMapper objectMapper,
                              AiCallRecorder recorder, MeterRegistry meterRegistry) {
        this.properties = properties;
        this.gms = gms;
        this.objectMapper = objectMapper;
        this.recorder = recorder;
        this.meterRegistry = meterRegistry;
        HttpClient httpClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(gms.connectTimeout())
                .build();
        this.queryClient = restClient(httpClient, properties.baseUrl(), properties.queryTimeout());
        this.documentClient = restClient(httpClient, properties.baseUrl(), properties.documentTimeout());
        CircuitBreakerRegistry registry = CircuitBreakerRegistry.of(breakerConfig(gms.circuitBreaker()));
        this.breaker = registry.circuitBreaker("embedding");
        TaggedCircuitBreakerMetrics.ofCircuitBreakerRegistry(registry).bindTo(meterRegistry);
        if (!StringUtils.hasText(gms.apiKey())) {
            log.warn("[EMBED] GMS_API_KEY가 비어 있습니다. 임베딩 호출이 실패하고 장면 찾기는 키워드 방식으로 동작합니다.");
        }
    }

    @Override
    public String model() {
        return properties.model();
    }

    @Override
    public List<float[]> embedDocuments(List<String> texts, Long jobId) {
        List<float[]> vectors = new ArrayList<>(texts.size());
        for (int from = 0; from < texts.size(); from += properties.batchSize()) {
            List<String> batch = texts.subList(from, Math.min(texts.size(), from + properties.batchSize()));
            vectors.addAll(call(documentClient, batch, "document", jobId, null));
        }
        return vectors;
    }

    @Override
    public float[] embedQuery(String text, Long chatLogId) {
        return call(queryClient, List.of(text), "query", null, chatLogId).get(0);
    }

    CircuitBreaker.State state() {
        return breaker.getState();
    }

    private List<float[]> call(RestClient client, List<String> texts, String use, Long jobId, Long chatLogId) {
        long start = System.nanoTime();
        try {
            EmbeddingResponse response = breaker.executeSupplier(() -> send(client, texts));
            List<float[]> vectors = vectors(response, texts.size());
            finish(use, jobId, chatLogId, response.usage() == null ? 0 : response.usage().tokens(), start, null);
            return vectors;
        } catch (CallNotPermittedException e) {
            finish(use, jobId, chatLogId, 0, start, CIRCUIT_OPEN);
            throw new LlmException(Kind.UNAVAILABLE, 0, "임베딩 서킷 브레이커가 열려 있습니다", e);
        } catch (LlmException e) {
            finish(use, jobId, chatLogId, 0, start, e.getKind().name());
            throw e;
        }
    }

    private EmbeddingResponse send(RestClient client, List<String> texts) {
        String key = apiKey();
        String body = objectMapper.writeValueAsString(
                new EmbeddingRequest(properties.model(), texts, properties.dimensions()));
        String response;
        try {
            response = client.post()
                    .uri("/v1/embeddings")
                    .headers(headers -> headers.setBearerAuth(key))
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve()
                    .body(String.class);
        } catch (RestClientResponseException e) {
            throw responseError(e.getStatusCode().value(), e.getResponseBodyAsString(), e);
        } catch (RestClientException e) {
            throw transportError(e);
        }
        try {
            return objectMapper.readValue(response, EmbeddingResponse.class);
        } catch (RuntimeException e) {
            log.error("[EMBED] 응답을 읽지 못했습니다: {}", abbreviate(response));
            throw new LlmException(Kind.INVALID, 200, "임베딩 응답 형식 오류", e);
        }
    }

    private List<float[]> vectors(EmbeddingResponse response, int expected) {
        float[][] ordered = new float[expected][];
        for (EmbeddingResponse.Item item : response.data() == null ? List.<EmbeddingResponse.Item>of() : response.data()) {
            if (item.index() < 0 || item.index() >= expected || item.embedding() == null
                    || item.embedding().length != properties.dimensions()) {
                throw new LlmException(Kind.INVALID, 200, "임베딩 응답이 요청과 맞지 않습니다", null);
            }
            ordered[item.index()] = item.embedding();
        }
        if (Arrays.stream(ordered).anyMatch(vector -> vector == null)) {
            throw new LlmException(Kind.INVALID, 200, "임베딩 응답 개수가 요청과 다릅니다", null);
        }
        return Arrays.asList(ordered);
    }

    private void finish(String use, Long jobId, Long chatLogId, int tokens, long start, String errorCode) {
        long latencyMs = Duration.ofNanos(System.nanoTime() - start).toMillis();
        try {
            recorder.record(AiCallLog.embed(properties.model(), jobId, chatLogId, tokens,
                    gms.credits(properties.model(), tokens, 0), (int) latencyMs, errorCode));
        } catch (RuntimeException e) {
            log.warn("[EMBED] ai_call_logs 기록 실패 - use={} ({})", use, e.getMessage());
        }
        Timer.builder("audisay.embedding")
                .description("임베딩 호출 시간")
                .tag("use", use)
                .tag("result", errorCode == null ? "ok" : errorCode)
                .publishPercentileHistogram()
                .register(meterRegistry)
                .record(latencyMs, TimeUnit.MILLISECONDS);
    }

    private String apiKey() {
        if (!StringUtils.hasText(gms.apiKey())) {
            throw new LlmException(Kind.UNAVAILABLE, 0, "GMS_API_KEY가 설정되지 않았습니다.", null);
        }
        return gms.apiKey();
    }

    private LlmException responseError(int status, String body, Throwable cause) {
        String text = body == null ? "" : body;
        Kind kind;
        if (status == 429 || text.contains("rate_limit")) {
            kind = Kind.RATE_LIMIT;
        } else if (status == 408 || status == 504) {
            kind = Kind.TIMEOUT;
        } else if (status >= 500) {
            kind = Kind.UNAVAILABLE;
        } else {
            kind = Kind.INVALID;
        }
        if (kind == Kind.INVALID) {
            log.error("[EMBED] 요청 오류 - status={}, body={}", status, abbreviate(text));
        } else {
            log.warn("[EMBED] 실패 - status={}, kind={}", status, kind);
        }
        return new LlmException(kind, status, "embedding " + status + ": " + abbreviate(text), cause);
    }

    private LlmException transportError(RestClientException e) {
        Kind kind = isReadTimeout(e) ? Kind.TIMEOUT : Kind.UNAVAILABLE;
        log.warn("[EMBED] 연결 실패 - {} ({})", kind, e.getMessage());
        return new LlmException(kind, 0, e.getMessage(), e);
    }

    private static boolean isReadTimeout(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof HttpConnectTimeoutException) {
                return false;
            }
            if (t instanceof HttpTimeoutException) {
                return true;
            }
        }
        return false;
    }

    private static RestClient restClient(HttpClient httpClient, String baseUrl, Duration readTimeout) {
        JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(httpClient);
        requestFactory.setReadTimeout(readTimeout);
        return RestClient.builder().baseUrl(baseUrl).requestFactory(requestFactory).build();
    }

    private static CircuitBreakerConfig breakerConfig(GmsProperties.Breaker breaker) {
        return CircuitBreakerConfig.custom()
                .slidingWindowType(CircuitBreakerConfig.SlidingWindowType.COUNT_BASED)
                .slidingWindowSize(breaker.slidingWindowSize())
                .minimumNumberOfCalls(breaker.minimumNumberOfCalls())
                .failureRateThreshold(breaker.failureRateThreshold())
                .waitDurationInOpenState(breaker.waitInOpenState())
                .permittedNumberOfCallsInHalfOpenState(breaker.permittedCallsInHalfOpen())
                .recordException(e -> e instanceof LlmException llm && llm.getKind().countsForBreaker())
                .ignoreException(e -> !(e instanceof LlmException))
                .build();
    }

    private static String abbreviate(String text) {
        if (text == null) {
            return "";
        }
        return text.length() <= MAX_ERROR_BODY ? text : text.substring(0, MAX_ERROR_BODY) + "...";
    }
}
