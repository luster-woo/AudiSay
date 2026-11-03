package com.audisay.global.external.llm;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.util.Locale;
import java.util.Map;

/**
 * 챗봇 LLM(GMS) 설정 (application.yml의 audisay.gms).
 *
 * @param mode                    real(기본) / mock(가짜 응답, 크레딧 0)
 * @param thinkingBudget          Gemini 추론 토큰 한도. 0이면 추론 끔, null이면 보내지 않음
 * @param timeouts                용도별 전체 시간 제한
 * @param streamFirstEventTimeout 스트리밍 첫 글자까지 시간 제한
 * @param prices                  모델별 토큰당 크레딧(GMS 단가). ai_call_logs.estimated_credits 계산
 * @param fallback                주 모델(Gemini)이 429·장애일 때 한 번 더 부를 대체 모델(다른 공급사)
 */
@ConfigurationProperties("audisay.gms")
public record GmsProperties(Mode mode, String apiKey, String geminiBaseUrl, String anthropicBaseUrl,
                            Duration connectTimeout, Integer thinkingBudget, Models models, Timeouts timeouts,
                            Duration streamFirstEventTimeout, Map<String, Price> prices, Breaker circuitBreaker,
                            Fallback fallback, Mock mock) {

    public GmsProperties {
        mode = mode == null ? Mode.REAL : mode;
        connectTimeout = connectTimeout == null ? Duration.ofSeconds(2) : connectTimeout;
        models = models == null ? new Models(null, null, null) : models;
        timeouts = timeouts == null ? new Timeouts(null, null, null) : timeouts;
        streamFirstEventTimeout = streamFirstEventTimeout == null ? Duration.ofSeconds(10) : streamFirstEventTimeout;
        prices = prices == null ? Map.of() : prices;
        circuitBreaker = circuitBreaker == null ? new Breaker(50, 20, 10, Duration.ofSeconds(30), 3) : circuitBreaker;
        fallback = fallback == null ? new Fallback(false, null) : fallback;
        mock = mock == null ? new Mock(Duration.ofMillis(300), null) : mock;
    }

    public enum Mode { REAL, MOCK }

    public record Models(String intent, String seek, String answer) {
    }

    public record Timeouts(Duration intent, Duration seek, Duration answer) {
    }

    public record Price(BigDecimal input, BigDecimal output) {
    }

    /** 용도별로 따로 만든다. 마지막 slidingWindowSize번 중 failureRateThreshold% 이상이 장애·시간 초과면 연다 */
    public record Breaker(float failureRateThreshold, int slidingWindowSize, int minimumNumberOfCalls,
                          Duration waitInOpenState, int permittedCallsInHalfOpen) {
    }

    /** @param models 용도별 대체 모델. 비어 있는 용도는 대체하지 않는다 */
    public record Fallback(boolean enabled, Models models) {
    }

    /** @param failure 주 모델에 일부러 낼 실패(없으면 정상 응답). 대체 모델은 늘 정상 */
    public record Mock(Duration latency, LlmException.Kind failure) {
    }

    public String model(LlmPurpose purpose) {
        String model = switch (purpose) {
            case INTENT -> models.intent();
            case SEEK -> models.seek();
            case ANSWER -> models.answer();
        };
        if (model == null || model.isBlank()) {
            throw new IllegalStateException("audisay.gms.models." + purpose.name().toLowerCase(Locale.ROOT) + " 설정이 없습니다.");
        }
        return model;
    }

    /** 대체하지 않으면 null */
    public String fallbackModel(LlmPurpose purpose) {
        if (!fallback.enabled() || fallback.models() == null) {
            return null;
        }
        String model = switch (purpose) {
            case INTENT -> fallback.models().intent();
            case SEEK -> fallback.models().seek();
            case ANSWER -> fallback.models().answer();
        };
        return model == null || model.isBlank() ? null : model;
    }

    public Duration timeout(LlmPurpose purpose) {
        Duration timeout = switch (purpose) {
            case INTENT -> timeouts.intent();
            case SEEK -> timeouts.seek();
            case ANSWER -> timeouts.answer();
        };
        return timeout == null ? Duration.ofSeconds(10) : timeout;
    }

    /** 단가표에 없는 모델(mock 등)은 0 */
    public BigDecimal credits(String model, int inputTokens, int outputTokens) {
        Price price = prices.get(model);
        if (price == null) {
            return BigDecimal.ZERO;
        }
        return price.input().multiply(BigDecimal.valueOf(inputTokens))
                .add(price.output().multiply(BigDecimal.valueOf(outputTokens)))
                .setScale(2, RoundingMode.HALF_UP);
    }
}
