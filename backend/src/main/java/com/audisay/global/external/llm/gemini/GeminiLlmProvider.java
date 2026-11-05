package com.audisay.global.external.llm.gemini;

import com.audisay.global.external.llm.AbstractHttpLlmProvider;
import com.audisay.global.external.llm.DeltaHandler;
import com.audisay.global.external.llm.GmsProperties;
import com.audisay.global.external.llm.LlmException;
import com.audisay.global.external.llm.LlmException.Kind;
import com.audisay.global.external.llm.LlmRequest;
import com.audisay.global.external.llm.LlmResult;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

/**
 * 주 모델. GMS를 거쳐 Gemini REST(generateContent, streamGenerateContent?alt=sse)를 부른다.
 */
@Slf4j
@Component("primaryLlmProvider")
@ConditionalOnProperty(prefix = "audisay.gms", name = "mode", havingValue = "real", matchIfMissing = true)
public class GeminiLlmProvider extends AbstractHttpLlmProvider {
    private static final String KEY_HEADER = "x-goog-api-key";
    private static final String MAX_TOKENS = "MAX_TOKENS";

    public GeminiLlmProvider(GmsProperties properties, ObjectMapper objectMapper) {
        super("gemini", properties.geminiBaseUrl(), properties, objectMapper);
    }

    @Override
    public LlmResult generate(LlmRequest request, String model) {
        long start = System.nanoTime();
        String response = post(request.purpose(), "/v1beta/models/" + model + ":generateContent", this::auth,
                toJson(GeminiRequest.of(request, properties.thinkingBudget(), properties.thinkingLevel(model))));
        GeminiResponse parsed = parse(response, GeminiResponse.class);
        rejectBlocked(parsed);
        GeminiResponse.UsageMetadata usage = parsed.usageMetadata() == null
                ? new GeminiResponse.UsageMetadata(0, 0, 0) : parsed.usageMetadata();
        return new LlmResult(parsed.text(), model, usage.input(), usage.output(), elapsedMs(start), false, null);
    }

    /** 이벤트마다 "data: {json}" 한 줄. 사용량은 마지막 조각에 전체 값이 온다 */
    @Override
    public LlmResult stream(LlmRequest request, String model, DeltaHandler handler) {
        long start = System.nanoTime();
        StringBuilder text = new StringBuilder();
        GeminiResponse.UsageMetadata[] usage = {new GeminiResponse.UsageMetadata(0, 0, 0)};
        boolean[] finished = {false};
        boolean cancelled = postSse(request.purpose(), "/v1beta/models/" + model + ":streamGenerateContent?alt=sse",
                this::auth, toJson(GeminiRequest.of(request, properties.thinkingBudget(), properties.thinkingLevel(model))), (data, control) -> {
                    GeminiResponse chunk = parse(data, GeminiResponse.class);
                    if (chunk.error() != null) {
                        throw streamError(chunk.error(), data);
                    }
                    rejectBlocked(chunk);
                    if (chunk.usageMetadata() != null) {
                        usage[0] = chunk.usageMetadata();
                    }
                    if (chunk.finished()) {
                        finished[0] = true;
                        control.finished();
                        if (MAX_TOKENS.equals(chunk.finishReason())) {
                            // 출력 한도에서 잘린 답(마지막 문장이 끊겼을 수 있음). 잦으면 한도를 늘린다
                            log.warn("[LLM] gemini 답이 출력 한도({}토큰)에서 잘림 purpose={}",
                                    request.maxOutputTokens(), request.purpose());
                        }
                    }
                    String delta = chunk.text();
                    if (delta.isEmpty()) {
                        return true;
                    }
                    control.textArrived();
                    text.append(delta);
                    return handler.onDelta(delta);
                });
        if (!cancelled && !finished[0]) {
            // GMS 프록시가 끝 조각 없이 연결을 닫으면 잘린 답을 성공으로 받지 않게(시작 전이면 대체 모델로)
            throw new LlmException(Kind.UNAVAILABLE, 0, "gemini 스트리밍이 끝 신호 없이 끊겼습니다", null);
        }
        return new LlmResult(text.toString(), model, usage[0].input(), usage[0].output(), elapsedMs(start),
                cancelled, null);
    }

    /** 스트림 도중 온 오류 조각. HTTP 상태와 같은 기준으로 나눈다(429·RESOURCE_EXHAUSTED → RATE_LIMIT, 5xx → UNAVAILABLE) */
    private LlmException streamError(GeminiResponse.ErrorBody error, String data) {
        int status = error.code() == null ? 500 : error.code();
        return responseError(status, data, null);
    }

    private void auth(HttpHeaders headers) {
        headers.set(KEY_HEADER, apiKey());
    }

    private static void rejectBlocked(GeminiResponse response) {
        String reason = response.blockReason();
        if (reason != null) {
            throw new LlmException(Kind.BLOCKED, 200, "안전 정책으로 거부됨: " + reason, null);
        }
    }
}
