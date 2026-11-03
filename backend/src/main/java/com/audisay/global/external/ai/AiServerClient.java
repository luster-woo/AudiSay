package com.audisay.global.external.ai;

import com.audisay.global.external.ai.AiServerException.Kind;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.http.client.MultipartBodyBuilder;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import tools.jackson.databind.ObjectMapper;

import java.net.http.HttpConnectTimeoutException;
import java.net.http.HttpClient;
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.util.Map;
import java.util.function.Supplier;

/**
 * AI 서버 내부 API(/internal/*). 오류 본문은 공통 응답 봉투 없이 {code, message}로 온다.
 */
@Slf4j
@Component
public class AiServerClient {
    private static final String TOKEN_HEADER = "X-Internal-Token";

    private final RestClient sttClient;
    private final RestClient ttsClient;
    private final String internalToken;
    private final ObjectMapper objectMapper;

    public AiServerClient(AiServerProperties properties, ObjectMapper objectMapper) {
        this.sttClient = restClient(properties, properties.sttTimeout());
        this.ttsClient = restClient(properties, properties.ttsTimeout());
        this.internalToken = properties.internalToken();
        this.objectMapper = objectMapper;
    }

    /** 녹음 → 글자. videoId가 있으면 AI 서버가 영상 제목·인물 이름을 받아쓰기 힌트로 넣는다 */
    public SttResult transcribe(byte[] audio, String filename, String contentType, Long videoId) {
        MultipartBodyBuilder body = new MultipartBodyBuilder();
        body.part("audio", new ByteArrayResource(audio) {
            @Override
            public String getFilename() {
                return filename;
            }
        }).contentType(MediaType.parseMediaType(contentType));
        if (videoId != null) {
            body.part("videoId", String.valueOf(videoId));
        }
        return call("stt", () -> sttClient.post()
                .uri("/internal/stt")
                .header(TOKEN_HEADER, requireToken())
                .contentType(MediaType.MULTIPART_FORM_DATA)
                .body(body.build())
                .retrieve()
                .body(SttResult.class));
    }

    /** 안내 문구 → 음성(H200 Supertonic). 만들지 못하면 AI가 오류 대신 audioUrl null로 준다 */
    public TtsResult synthesize(String text, String voice) {
        return call("tts", () -> ttsClient.post()
                .uri("/internal/tts")
                .header(TOKEN_HEADER, requireToken())
                .contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("text", text, "voice", voice))
                .retrieve()
                .body(TtsResult.class));
    }

    private <T> T call(String operation, Supplier<T> request) {
        try {
            return request.get();
        } catch (RestClientResponseException e) {
            AiError error = parseError(e.getResponseBodyAsString());
            log.warn("[AI] {} 실패 - status={}, code={}", operation, e.getStatusCode().value(), error.code());
            throw new AiServerException(Kind.RESPONSE, e.getStatusCode().value(), error.code(), error.message(), e);
        } catch (RestClientException e) {
            Kind kind = isReadTimeout(e) ? Kind.TIMEOUT : Kind.UNAVAILABLE;
            log.warn("[AI] {} 실패 - {} ({})", operation, kind, e.getMessage());
            throw new AiServerException(kind, 0, null, e.getMessage(), e);
        }
    }

    private AiError parseError(String body) {
        try {
            AiError error = objectMapper.readValue(body, AiError.class);
            return error.code() == null && error.detail() != null ? error.detail() : error;
        } catch (RuntimeException e) {
            return new AiError(null, body, null);
        }
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

    private String requireToken() {
        if (!StringUtils.hasText(internalToken)) {
            throw new AiServerException(Kind.UNAVAILABLE, 0, null, "AI_INTERNAL_TOKEN이 설정되지 않았습니다.", null);
        }
        return internalToken;
    }

    private static RestClient restClient(AiServerProperties properties, Duration readTimeout) {
        // JDK 클라이언트는 http://에서 HTTP/2 업그레이드를 시도하는데 uvicorn이 거부해 요청이 깨진다
        HttpClient httpClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(properties.connectTimeout())
                .build();
        JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(httpClient);
        requestFactory.setReadTimeout(readTimeout);
        return RestClient.builder()
                .baseUrl(properties.baseUrl())
                .requestFactory(requestFactory)
                .build();
    }

    /** FastAPI 기본 형식({detail: {...}})으로 와도 읽는다 */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record AiError(String code, String message, AiError detail) {
    }
}
