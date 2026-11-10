package com.audisay.domain.chat.screen;

import com.audisay.global.aicall.AiCallLog;
import com.audisay.global.aicall.AiCallPurpose;
import com.audisay.global.aicall.AiCallRecorder;
import com.audisay.global.external.llm.GmsProperties;
import com.audisay.global.external.llm.gemini.GeminiResponse;
import lombok.extern.slf4j.Slf4j;
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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 유튜브 구간을 Gemini에 보여 주고 묻는다(GMS generateContent, fileData = 유튜브 주소, videoMetadata = 시작·끝 초).
 * 영상은 Gemini가 유튜브에서 직접 본다(내려받지 않음). 구간만큼만 토큰이 든다(1초에 약 100토큰, 30초 vs 60초 실측 2배).
 * 실패(429·시간 초과·오류·안전 거부)는 예외 대신 null: 화면 다시 보기는 덤이라 호출한 쪽은 원래 답으로 돌아간다.
 * 호출마다 ai_call_logs 한 행(purpose QUESTION, 크레딧 = 토큰 × 단가). mock 모드·키 없음이면 부르지 않고 null
 */
@Slf4j
@Component
public class ScreenVideoClient {
    private static final String KEY_HEADER = "x-goog-api-key";
    /** thinkingBudget 0을 거부하는 모델(400)에 다시 보낼 추론 단계 */
    private static final String MIN_THINKING_LEVEL = "minimal";

    private final GmsProperties gms;
    private final ScreenCheckProperties properties;
    private final ObjectMapper objectMapper;
    private final AiCallRecorder recorder;
    private final RestClient restClient;

    public ScreenVideoClient(GmsProperties gms, ScreenCheckProperties properties, ObjectMapper objectMapper,
                             AiCallRecorder recorder) {
        this.gms = gms;
        this.properties = properties;
        this.objectMapper = objectMapper;
        this.recorder = recorder;
        HttpClient httpClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(gms.connectTimeout())
                .build();
        JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(httpClient);
        requestFactory.setReadTimeout(properties.timeout());
        this.restClient = RestClient.builder()
                .baseUrl(gms.geminiBaseUrl() == null ? "" : gms.geminiBaseUrl())
                .requestFactory(requestFactory)
                .build();
    }

    /** @param text 모델 답(공백만이면 빈 문자열) */
    public record Answer(String text, String model, long latencyMs) {
    }

    /**
     * @param startSec 구간 시작(초)
     * @param endSec   구간 끝(초). 질문한 시각을 넘기지 않는다(뒤 내용이 섞이지 않게)
     * @return 실패면 null
     */
    public Answer ask(String model, String youtubeUrl, int startSec, int endSec, String system, String question,
                      Long chatLogId) {
        if (gms.mode() == GmsProperties.Mode.MOCK || !StringUtils.hasText(gms.apiKey())
                || !StringUtils.hasText(gms.geminiBaseUrl())) {
            return null;
        }
        String level = gms.thinkingLevel(model);
        Map<String, Object> thinking = level != null ? Map.of("thinkingLevel", level)
                : gms.thinkingBudget() != null ? Map.of("thinkingBudget", gms.thinkingBudget()) : null;
        Attempt first = attempt(model, youtubeUrl, startSec, endSec, system, question, thinking, chatLogId);
        if (first.status() == 400 && thinking != null && level == null) {
            // 추론을 끌 수 없는 모델(3.5-flash-lite는 thinkingBudget 0이면 400). 가장 적은 추론 단계로 한 번 더
            log.info("[SCREEN] {} 이(가) 추론 끄기를 거부해 {}로 다시 부릅니다", model, MIN_THINKING_LEVEL);
            return attempt(model, youtubeUrl, startSec, endSec, system, question,
                    Map.of("thinkingLevel", MIN_THINKING_LEVEL), chatLogId).answer();
        }
        return first.answer();
    }

    private record Attempt(Answer answer, int status) {
    }

    private Attempt attempt(String model, String youtubeUrl, int startSec, int endSec, String system, String question,
                            Map<String, Object> thinking, Long chatLogId) {
        long start = System.nanoTime();
        String body = objectMapper.writeValueAsString(
                body(youtubeUrl, startSec, endSec, system, question, thinking));
        try {
            String response = restClient.post()
                    .uri("/v1beta/models/" + model + ":generateContent")
                    .headers(headers -> headers.set(KEY_HEADER, gms.apiKey()))
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve()
                    .body(String.class);
            GeminiResponse parsed = objectMapper.readValue(response, GeminiResponse.class);
            long latencyMs = elapsedMs(start);
            GeminiResponse.UsageMetadata usage = parsed.usageMetadata() == null
                    ? new GeminiResponse.UsageMetadata(0, 0, 0) : parsed.usageMetadata();
            if (parsed.blockReason() != null) {
                record(model, chatLogId, usage.input(), usage.output(), latencyMs, "BLOCKED");
                return new Attempt(null, 200);
            }
            record(model, chatLogId, usage.input(), usage.output(), latencyMs, null);
            return new Attempt(new Answer(parsed.text().strip(), model, latencyMs), 200);
        } catch (RestClientResponseException e) {
            int status = e.getStatusCode().value();
            String text = e.getResponseBodyAsString();
            String code = status == 429 || text.contains("RESOURCE_EXHAUSTED") ? "RATE_LIMIT"
                    : status == 408 || status == 504 ? "TIMEOUT" : status >= 500 ? "UNAVAILABLE" : "INVALID";
            log.warn("[SCREEN] {} 실패 status={} code={} body={}", model, status, code, abbreviate(text));
            record(model, chatLogId, 0, 0, elapsedMs(start), code);
            return new Attempt(null, status);
        } catch (RestClientException e) {
            String code = isReadTimeout(e) ? "TIMEOUT" : "UNAVAILABLE";
            log.warn("[SCREEN] {} 연결 실패 {} ({})", model, code, e.getMessage());
            record(model, chatLogId, 0, 0, elapsedMs(start), code);
            return new Attempt(null, 0);
        } catch (RuntimeException e) {
            // 응답을 읽지 못함(형식 오류)
            log.warn("[SCREEN] {} 응답을 읽지 못함: {}", model, e.getMessage());
            record(model, chatLogId, 0, 0, elapsedMs(start), "INVALID");
            return new Attempt(null, 200);
        }
    }

    /** 영상 파트(유튜브 주소 + 구간) 다음에 질문 글. 해상도는 기본값(올려도 작은 HUD 숫자는 못 읽고 토큰만 3배였다) */
    Map<String, Object> body(String youtubeUrl, int startSec, int endSec, String system, String question,
                             Map<String, Object> thinking) {
        Map<String, Object> video = new LinkedHashMap<>();
        video.put("fileData", Map.of("fileUri", youtubeUrl, "mimeType", "video/*"));
        video.put("videoMetadata", Map.of("startOffset", startSec + "s", "endOffset", endSec + "s"));
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("temperature", 0);
        config.put("maxOutputTokens", properties.maxOutputTokens());
        if (thinking != null) {
            config.put("thinkingConfig", thinking);
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("systemInstruction", Map.of("parts", List.of(Map.of("text", system))));
        body.put("contents", List.of(Map.of("role", "user", "parts", List.of(video, Map.of("text", question)))));
        body.put("generationConfig", config);
        return body;
    }

    private void record(String model, Long chatLogId, int inputTokens, int outputTokens, long latencyMs, String errorCode) {
        try {
            recorder.record(AiCallLog.chat(AiCallPurpose.QUESTION, model, chatLogId, inputTokens, outputTokens,
                    gms.credits(model, inputTokens, outputTokens), (int) latencyMs, false, errorCode));
        } catch (RuntimeException e) {
            log.warn("[SCREEN] ai_call_logs 기록 실패 model={} ({})", model, e.getMessage());
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

    private static long elapsedMs(long startNanos) {
        return (System.nanoTime() - startNanos) / 1_000_000;
    }

    private static String abbreviate(String text) {
        if (text == null) {
            return "";
        }
        return text.length() <= 300 ? text : text.substring(0, 300) + "...";
    }
}
