package com.audisay.global.external.llm.mock;

import com.audisay.global.external.llm.DeltaHandler;
import com.audisay.global.external.llm.LlmException;
import com.audisay.global.external.llm.LlmProvider;
import com.audisay.global.external.llm.LlmRequest;
import com.audisay.global.external.llm.LlmResult;

import java.time.Duration;

/**
 * GMS를 부르지 않고 정해진 응답을 준다(크레딧 0). failure가 있으면 그 실패를 낸다. 빈 등록은 MockLlmConfig.
 */
public class FakeLlmProvider implements LlmProvider {
    static final String INTENT_JSON = "{\"intent\":\"QUESTION\",\"slots\":{}}";
    static final String SEEK_JSON = "{\"n\":[1]}";
    static final String ANSWER = "가짜 답변이에요. GMS를 켜면 실제 답변이 나와요.";

    private final String model;
    private final Duration latency;
    private final LlmException.Kind failure;

    public FakeLlmProvider(String model, Duration latency, LlmException.Kind failure) {
        this.model = model;
        this.latency = latency == null ? Duration.ZERO : latency;
        this.failure = failure;
    }

    @Override
    public LlmResult generate(LlmRequest request, String model) {
        sleep(latency);
        failIfConfigured();
        return result(request, textOf(request), false);
    }

    @Override
    public LlmResult stream(LlmRequest request, String model, DeltaHandler handler) {
        failIfConfigured();
        String[] words = textOf(request).split("(?<= )");
        Duration perWord = latency.dividedBy(Math.max(1, words.length));
        StringBuilder sent = new StringBuilder();
        for (String word : words) {
            sleep(perWord);
            sent.append(word);
            if (!handler.onDelta(word)) {
                return result(request, sent.toString(), true);
            }
        }
        return result(request, sent.toString(), false);
    }

    private static String textOf(LlmRequest request) {
        return switch (request.purpose()) {
            case INTENT -> INTENT_JSON;
            case SEEK -> SEEK_JSON;
            case ANSWER -> ANSWER;
        };
    }

    private LlmResult result(LlmRequest request, String text, boolean cancelled) {
        int input = (request.system() == null ? 0 : request.system().length()) / 2 + request.user().length() / 2;
        return new LlmResult(text, model, input, text.length() / 2, latency.toMillis(), cancelled, null);
    }

    private void failIfConfigured() {
        if (failure != null) {
            throw new LlmException(failure, 0, "mock 장애 주입: " + failure, null);
        }
    }

    private static void sleep(Duration duration) {
        try {
            Thread.sleep(duration.toMillis());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
