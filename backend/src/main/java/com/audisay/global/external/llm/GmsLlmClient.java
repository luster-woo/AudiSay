package com.audisay.global.external.llm;

import com.audisay.global.aicall.AiCallLog;
import com.audisay.global.aicall.AiCallRecorder;
import com.audisay.global.external.llm.LlmException.Kind;
import io.github.resilience4j.circuitbreaker.CallNotPermittedException;
import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import io.github.resilience4j.circuitbreaker.CircuitBreakerConfig;
import io.github.resilience4j.circuitbreaker.CircuitBreakerRegistry;
import io.github.resilience4j.micrometer.tagged.TaggedCircuitBreakerMetrics;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.EnumMap;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;

/**
 * 챗봇 LLM 호출 입구. 주 모델(Gemini)을 용도별 서킷 브레이커를 거쳐 부르고, 429·장애·서킷 열림이면 대체 모델(Claude)을
 * 한 번 더 부른다. 성공·실패 모두 ai_call_logs에 남긴다(대체 호출은 is_fallback).
 * 서킷은 장애·시간 초과만 실패로 센다(429·안전 정책 거부·요청 오류는 공급사가 살아 있다는 뜻).
 * 대체하지 않는 경우: 시간 초과(이미 오래 기다림), 안전 정책 거부·요청 오류(다른 모델도 같을 가능성), 스트리밍이 시작된 뒤 끊김
 * (사용자에게 보낸 말과 섞임).
 */
@Slf4j
@Component
public class GmsLlmClient implements LlmClient {
    static final String CIRCUIT_OPEN = "CIRCUIT_OPEN";
    static final String CALLER_ERROR = "CALLER_ERROR";

    private final LlmProvider primary;
    private final LlmProvider fallback;
    private final GmsProperties properties;
    private final AiCallRecorder recorder;
    private final MeterRegistry meterRegistry;
    private final Map<LlmPurpose, CircuitBreaker> primaryBreakers = new EnumMap<>(LlmPurpose.class);
    private final Map<LlmPurpose, CircuitBreaker> fallbackBreakers = new EnumMap<>(LlmPurpose.class);

    public GmsLlmClient(@Qualifier("primaryLlmProvider") LlmProvider primary,
                        @Qualifier("fallbackLlmProvider") Optional<LlmProvider> fallback,
                        GmsProperties properties, AiCallRecorder recorder, MeterRegistry meterRegistry) {
        this.primary = primary;
        this.fallback = fallback.orElse(null);
        this.properties = properties;
        this.recorder = recorder;
        this.meterRegistry = meterRegistry;
        CircuitBreakerRegistry registry = CircuitBreakerRegistry.of(breakerConfig(properties.circuitBreaker()));
        for (LlmPurpose purpose : LlmPurpose.values()) {
            String name = "llm-" + purpose.name().toLowerCase(Locale.ROOT);
            primaryBreakers.put(purpose, registry.circuitBreaker(name));
            fallbackBreakers.put(purpose, registry.circuitBreaker(name + "-fallback"));
        }
        TaggedCircuitBreakerMetrics.ofCircuitBreakerRegistry(registry).bindTo(meterRegistry);
    }

    @Override
    public LlmResult generate(LlmRequest request) {
        return call(request, (provider, model) -> provider.generate(request, model), () -> false);
    }

    @Override
    public LlmResult stream(LlmRequest request, DeltaHandler handler) {
        AtomicBoolean started = new AtomicBoolean();
        DeltaHandler tracking = delta -> {
            started.set(true);
            return handler.onDelta(delta);
        };
        return call(request, (provider, model) -> provider.stream(request, model, tracking), started::get);
    }

    CircuitBreaker.State state(LlmPurpose purpose) {
        return primaryBreakers.get(purpose).getState();
    }

    @FunctionalInterface
    private interface Invocation {
        LlmResult call(LlmProvider provider, String model);
    }

    private LlmResult call(LlmRequest request, Invocation invocation, BooleanSupplier streamStarted) {
        try {
            return attempt(request, primary, properties.model(request.purpose()), primaryBreakers, invocation, false);
        } catch (LlmException e) {
            String fallbackModel = properties.fallbackModel(request.purpose());
            if (fallback == null || fallbackModel == null || request.noFallback() || !shouldFallback(e)
                    || streamStarted.getAsBoolean() || !hasTimeForFallback(request)) {
                throw e;
            }
            log.warn("[LLM] {} 주 모델 실패({}) → 대체 모델 {}", request.purpose(), e.getKind(), fallbackModel);
            return attempt(request, fallback, fallbackModel, fallbackBreakers, invocation, true);
        }
    }

    /** 호출한 쪽 응답 시간 예산 안에 대체 모델 한 번을 다 기다릴 수 있는지 */
    private boolean hasTimeForFallback(LlmRequest request) {
        Long deadline = request.fallbackDeadlineNanos();
        if (deadline == null || deadline - System.nanoTime() >= properties.timeout(request.purpose()).toNanos()) {
            return true;
        }
        log.warn("[LLM] {} 주 모델 실패, 응답 시간 예산이 모자라 대체 모델을 부르지 않음", request.purpose());
        return false;
    }

    private static boolean shouldFallback(LlmException e) {
        return e.getKind() == Kind.RATE_LIMIT || e.getKind() == Kind.UNAVAILABLE;
    }

    private LlmResult attempt(LlmRequest request, LlmProvider provider, String model,
                              Map<LlmPurpose, CircuitBreaker> breakers, Invocation invocation, boolean isFallback) {
        long start = System.nanoTime();
        try {
            LlmResult result = breakers.get(request.purpose()).executeSupplier(() -> invocation.call(provider, model));
            Long callLogId = record(request, result.model(), result.inputTokens(), result.outputTokens(),
                    result.latencyMs(), isFallback, null);
            time(request.purpose(), result.model(), isFallback, "ok", result.latencyMs());
            return result.withCallLogId(callLogId);
        } catch (CallNotPermittedException e) {
            failed(request, model, isFallback, start, CIRCUIT_OPEN);
            throw new LlmException(Kind.UNAVAILABLE, 0, "LLM 서킷 브레이커가 열려 있습니다: " + model, e);
        } catch (LlmException e) {
            failed(request, model, isFallback, start, e.getKind().name());
            throw e;
        } catch (RuntimeException e) {
            // 스트리밍 handler(호출한 쪽)에서 난 오류. LLM 장애가 아니라 서킷에도 세지 않는다
            failed(request, model, isFallback, start, CALLER_ERROR);
            throw e;
        }
    }

    private void failed(LlmRequest request, String model, boolean isFallback, long start, String errorCode) {
        long latencyMs = Duration.ofNanos(System.nanoTime() - start).toMillis();
        record(request, model, 0, 0, latencyMs, isFallback, errorCode);
        time(request.purpose(), model, isFallback, errorCode, latencyMs);
    }

    private Long record(LlmRequest request, String model, int inputTokens, int outputTokens, long latencyMs,
                        boolean isFallback, String errorCode) {
        try {
            AiCallLog callLog = AiCallLog.chat(request.purpose().logPurpose(), model, request.chatLogId(),
                    inputTokens, outputTokens, properties.credits(model, inputTokens, outputTokens),
                    (int) latencyMs, isFallback, errorCode);
            return recorder.record(callLog);
        } catch (RuntimeException e) {
            log.warn("[LLM] ai_call_logs 기록 실패 - purpose={}, model={} ({})", request.purpose(), model, e.getMessage());
            return null;
        }
    }

    private void time(LlmPurpose purpose, String model, boolean isFallback, String result, long latencyMs) {
        Timer.builder("audisay.llm")
                .description("챗봇 LLM 호출 시간")
                .tag("purpose", purpose.name())
                .tag("model", model)
                .tag("fallback", String.valueOf(isFallback))
                .tag("result", result)
                .publishPercentileHistogram()
                .register(meterRegistry)
                .record(latencyMs, TimeUnit.MILLISECONDS);
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
                // 호출한 쪽(스트리밍 handler)에서 난 오류는 LLM 상태와 무관해 성공으로도 세지 않는다
                .ignoreException(e -> !(e instanceof LlmException))
                .build();
    }
}
