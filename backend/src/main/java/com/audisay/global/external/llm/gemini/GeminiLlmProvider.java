package com.audisay.global.external.llm.gemini;

import com.audisay.global.external.llm.AbstractHttpLlmProvider;
import com.audisay.global.external.llm.DeltaHandler;
import com.audisay.global.external.llm.GmsProperties;
import com.audisay.global.external.llm.LlmException;
import com.audisay.global.external.llm.LlmException.Kind;
import com.audisay.global.external.llm.LlmRequest;
import com.audisay.global.external.llm.LlmResult;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

/**
 * 주 모델. GMS를 거쳐 Gemini REST(generateContent, streamGenerateContent?alt=sse)를 부른다.
 */
@Component("primaryLlmProvider")
@ConditionalOnProperty(prefix = "audisay.gms", name = "mode", havingValue = "real", matchIfMissing = true)
public class GeminiLlmProvider extends AbstractHttpLlmProvider {
    private static final String KEY_HEADER = "x-goog-api-key";

    public GeminiLlmProvider(GmsProperties properties, ObjectMapper objectMapper) {
        super("gemini", properties.geminiBaseUrl(), properties, objectMapper);
    }

    @Override
    public LlmResult generate(LlmRequest request, String model) {
        long start = System.nanoTime();
        String response = post(request.purpose(), "/v1beta/models/" + model + ":generateContent", this::auth,
                toJson(GeminiRequest.of(request, properties.thinkingBudget())));
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
        boolean cancelled = postSse(request.purpose(), "/v1beta/models/" + model + ":streamGenerateContent?alt=sse",
                this::auth, toJson(GeminiRequest.of(request, properties.thinkingBudget())), (data, textArrived) -> {
                    GeminiResponse chunk = parse(data, GeminiResponse.class);
                    rejectBlocked(chunk);
                    if (chunk.usageMetadata() != null) {
                        usage[0] = chunk.usageMetadata();
                    }
                    String delta = chunk.text();
                    if (delta.isEmpty()) {
                        return true;
                    }
                    textArrived.run();
                    text.append(delta);
                    return handler.onDelta(delta);
                });
        return new LlmResult(text.toString(), model, usage[0].input(), usage[0].output(), elapsedMs(start),
                cancelled, null);
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
