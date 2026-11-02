package com.audisay.global.external.llm;

import com.audisay.global.external.llm.LlmException.Kind;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.ClientHttpResponse;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import tools.jackson.databind.ObjectMapper;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.http.HttpClient;
import java.net.http.HttpConnectTimeoutException;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.EnumMap;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

/**
 * GMS를 거쳐 HTTP로 부르는 공급사 공통: 용도별 읽기 시간 제한, 실패 종류 나누기, SSE 스트림 읽기(첫 글자·전체 시간 감시).
 */
@Slf4j
public abstract class AbstractHttpLlmProvider implements LlmProvider {
    private static final int MAX_ERROR_BODY = 300;

    protected final GmsProperties properties;
    protected final ObjectMapper objectMapper;
    private final String name;
    private final Map<LlmPurpose, RestClient> clients = new EnumMap<>(LlmPurpose.class);
    private final ScheduledExecutorService watchdog;

    protected AbstractHttpLlmProvider(String name, String baseUrl, GmsProperties properties, ObjectMapper objectMapper) {
        this.name = name;
        this.properties = properties;
        this.objectMapper = objectMapper;
        HttpClient httpClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(properties.connectTimeout())
                .build();
        for (LlmPurpose purpose : LlmPurpose.values()) {
            JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(httpClient);
            requestFactory.setReadTimeout(properties.timeout(purpose));
            clients.put(purpose, RestClient.builder().baseUrl(baseUrl).requestFactory(requestFactory).build());
        }
        this.watchdog = Executors.newSingleThreadScheduledExecutor(runnable -> {
            Thread thread = new Thread(runnable, "llm-" + name + "-watchdog");
            thread.setDaemon(true);
            return thread;
        });
        if (!StringUtils.hasText(properties.apiKey())) {
            log.warn("[LLM] GMS_API_KEY가 비어 있습니다. {} 호출이 CHAT_005로 실패합니다.", name);
        }
    }

    @PreDestroy
    public void shutdown() {
        watchdog.shutdownNow();
    }

    /** SSE data 한 줄을 처리한다 */
    @FunctionalInterface
    protected interface SseData {
        /**
         * @param textArrived 글이 왔을 때 부른다(첫 글자 시간 감시를 끈다)
         * @return 그만 받으려면 false
         */
        boolean accept(String data, Runnable textArrived);
    }

    /** 한 번에 받기 */
    protected String post(LlmPurpose purpose, String uri, Consumer<HttpHeaders> headers, String body) {
        try {
            return clients.get(purpose).post()
                    .uri(uri)
                    .headers(headers)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve()
                    .body(String.class);
        } catch (RestClientResponseException e) {
            throw responseError(e.getStatusCode().value(), e.getResponseBodyAsString(), e);
        } catch (RestClientException e) {
            throw transportError(e);
        }
    }

    /** SSE로 조금씩 받기. 호출한 쪽이 멈췄으면 true */
    protected boolean postSse(LlmPurpose purpose, String uri, Consumer<HttpHeaders> headers, String body, SseData onData) {
        long start = System.nanoTime();
        try {
            return clients.get(purpose).post()
                    .uri(uri)
                    .headers(headers)
                    .contentType(MediaType.APPLICATION_JSON)
                    .accept(MediaType.TEXT_EVENT_STREAM)
                    .body(body)
                    .exchange((clientRequest, response) -> readSse(response, purpose, start, onData));
        } catch (RestClientException e) {
            throw transportError(e);
        }
    }

    private boolean readSse(ClientHttpResponse response, LlmPurpose purpose, long start, SseData onData)
            throws IOException {
        int status = response.getStatusCode().value();
        if (status >= 400) {
            String error = new String(response.getBody().readAllBytes(), StandardCharsets.UTF_8);
            throw responseError(status, error, null);
        }
        InputStream in = response.getBody();
        AtomicBoolean timedOut = new AtomicBoolean();
        Runnable expire = () -> {
            timedOut.set(true);
            closeQuietly(in);
        };
        ScheduledFuture<?> firstEvent = watchdog.schedule(expire,
                properties.streamFirstEventTimeout().toMillis(), TimeUnit.MILLISECONDS);
        ScheduledFuture<?> total = watchdog.schedule(expire,
                Math.max(0, properties.timeout(purpose).toMillis() - elapsedMs(start)), TimeUnit.MILLISECONDS);
        Runnable textArrived = () -> firstEvent.cancel(false);
        boolean stopped = false;
        try {
            BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.startsWith("data:") && !onData.accept(line.substring(5).trim(), textArrived)) {
                    stopped = true;
                    break;
                }
            }
        } catch (IOException e) {
            if (timedOut.get()) {
                throw new LlmException(Kind.TIMEOUT, 0, name + " 스트리밍 시간 초과", e);
            }
            throw new LlmException(Kind.UNAVAILABLE, 0, name + " 스트리밍이 끊겼습니다: " + e.getMessage(), e);
        } finally {
            firstEvent.cancel(false);
            total.cancel(false);
        }
        if (timedOut.get()) {
            throw new LlmException(Kind.TIMEOUT, 0, name + " 스트리밍 시간 초과", null);
        }
        return stopped;
    }

    protected String toJson(Object body) {
        return objectMapper.writeValueAsString(body);
    }

    protected <T> T parse(String json, Class<T> type) {
        try {
            return objectMapper.readValue(json, type);
        } catch (RuntimeException e) {
            log.error("[LLM] {} 응답을 읽지 못했습니다: {}", name, abbreviate(json));
            throw new LlmException(Kind.INVALID, 200, name + " 응답 형식 오류", e);
        }
    }

    protected String apiKey() {
        if (!StringUtils.hasText(properties.apiKey())) {
            throw new LlmException(Kind.UNAVAILABLE, 0, "GMS_API_KEY가 설정되지 않았습니다.", null);
        }
        return properties.apiKey();
    }

    protected LlmException responseError(int status, String body, Throwable cause) {
        String text = body == null ? "" : body;
        Kind kind;
        if (status == 429 || text.contains("RESOURCE_EXHAUSTED") || text.contains("rate_limit_error")) {
            kind = Kind.RATE_LIMIT;
        } else if (status == 408 || status == 504) {
            kind = Kind.TIMEOUT;
        } else if (status >= 500) {
            kind = Kind.UNAVAILABLE;
        } else {
            kind = Kind.INVALID;
        }
        if (kind == Kind.INVALID) {
            log.error("[LLM] {} 요청 오류 - status={}, body={}", name, status, abbreviate(text));
        } else {
            log.warn("[LLM] {} 실패 - status={}, kind={}", name, status, kind);
        }
        return new LlmException(kind, status, name + " " + status + ": " + abbreviate(text), cause);
    }

    private LlmException transportError(RestClientException e) {
        Kind kind = isReadTimeout(e) ? Kind.TIMEOUT : Kind.UNAVAILABLE;
        log.warn("[LLM] {} 연결 실패 - {} ({})", name, kind, e.getMessage());
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

    protected static long elapsedMs(long startNanos) {
        return Duration.ofNanos(System.nanoTime() - startNanos).toMillis();
    }

    private static String abbreviate(String text) {
        if (text == null) {
            return "";
        }
        return text.length() <= MAX_ERROR_BODY ? text : text.substring(0, MAX_ERROR_BODY) + "...";
    }

    private static void closeQuietly(InputStream in) {
        try {
            in.close();
        } catch (IOException ignored) {
            // 감시 스레드가 끊는 중이라 무시
        }
    }
}
