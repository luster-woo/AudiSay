package com.audisay.global.external.llm;

import com.audisay.global.aicall.AiCallLog;
import com.audisay.global.aicall.AiCallPurpose;
import com.audisay.global.aicall.AiCallRecorder;
import com.audisay.global.external.llm.LlmException.Kind;
import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.math.BigDecimal;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class GmsLlmClientTest {
    private static final String MODEL = "gemini-3.1-flash-lite";
    private static final String FALLBACK_MODEL = "claude-haiku-5-5";

    private LlmProvider primary;
    private LlmProvider fallback;
    private AiCallRecorder recorder;

    @BeforeEach
    void setUp() {
        primary = mock(LlmProvider.class);
        fallback = mock(LlmProvider.class);
        recorder = mock(AiCallRecorder.class);
        when(recorder.record(any())).thenReturn(7L);
    }

    private GmsLlmClient client(boolean withFallback) {
        GmsProperties properties = new GmsProperties(GmsProperties.Mode.REAL, "key", "http://unused", "http://unused",
                null, 0, null, new GmsProperties.Models(MODEL, MODEL, MODEL), null, null,
                Map.of(MODEL, new GmsProperties.Price(new BigDecimal("0.0025"), new BigDecimal("0.015")),
                        FALLBACK_MODEL, new GmsProperties.Price(new BigDecimal("0.001"), new BigDecimal("0.005"))),
                new GmsProperties.Breaker(50, 4, 4, Duration.ofMinutes(1), 1),
                new GmsProperties.Fallback(withFallback,
                        new GmsProperties.Models(FALLBACK_MODEL, FALLBACK_MODEL, FALLBACK_MODEL)), null);
        return new GmsLlmClient(primary, withFallback ? Optional.of(fallback) : Optional.empty(), properties,
                recorder, new SimpleMeterRegistry());
    }

    @Test
    void 성공하면_토큰과_크레딧을_기록하고_기록_ID를_돌려준다() {
        when(primary.generate(any(), anyString())).thenReturn(new LlmResult("{}", MODEL, 440, 20, 900, false, null));

        LlmResult result = client(false).generate(intent().withChatLogId(31L));

        assertThat(result.callLogId()).isEqualTo(7L);
        AiCallLog saved = captured(1).get(0);
        assertThat(saved.getPurpose()).isEqualTo(AiCallPurpose.INTENT);
        assertThat(saved.getChatLogId()).isEqualTo(31L);
        assertThat(saved.getEstimatedCredits()).isEqualByComparingTo("1.40");
        assertThat(saved.getLatencyMs()).isEqualTo(900);
        assertThat(saved.getFallback()).isFalse();
        assertThat(saved.getErrorCode()).isNull();
    }

    @Test
    void 답변은_QUESTION으로_기록한다() {
        when(primary.stream(any(), anyString(), any())).thenReturn(new LlmResult("답", MODEL, 1, 1, 10, false, null));

        client(false).stream(LlmRequest.text(LlmPurpose.ANSWER, "s", "u", 300), delta -> true);

        assertThat(captured(1).get(0).getPurpose()).isEqualTo(AiCallPurpose.QUESTION);
    }

    @Test
    void 실패도_오류_코드로_기록하고_그대로_던진다() {
        when(primary.generate(any(), anyString())).thenThrow(new LlmException(Kind.TIMEOUT, 0, "느림", null));

        assertThatThrownBy(() -> client(false).generate(intent())).isInstanceOf(LlmException.class);

        AiCallLog saved = captured(1).get(0);
        assertThat(saved.getErrorCode()).isEqualTo("TIMEOUT");
        assertThat(saved.getModel()).isEqualTo(MODEL);
        assertThat(saved.getInputTokens()).isZero();
    }

    @Test
    void 장애가_이어지면_서킷이_열려_GMS를_부르지_않는다() {
        GmsLlmClient client = client(false);
        when(primary.generate(any(), anyString())).thenThrow(new LlmException(Kind.UNAVAILABLE, 503, "down", null));

        for (int i = 0; i < 4; i++) {
            assertThatThrownBy(() -> client.generate(intent())).isInstanceOf(LlmException.class);
        }
        assertThat(client.state(LlmPurpose.INTENT)).isEqualTo(CircuitBreaker.State.OPEN);

        assertKind(() -> client.generate(intent()), Kind.UNAVAILABLE);
        verify(primary, times(4)).generate(any(), anyString());
        assertThat(client.state(LlmPurpose.ANSWER)).isEqualTo(CircuitBreaker.State.CLOSED);
    }

    @Test
    void 한도_초과_429는_서킷_실패로_세지_않는다() {
        GmsLlmClient client = client(false);
        when(primary.generate(any(), anyString())).thenThrow(new LlmException(Kind.RATE_LIMIT, 429, "limit", null));

        for (int i = 0; i < 6; i++) {
            assertThatThrownBy(() -> client.generate(intent())).isInstanceOf(LlmException.class);
        }

        assertThat(client.state(LlmPurpose.INTENT)).isEqualTo(CircuitBreaker.State.CLOSED);
        verify(primary, times(6)).generate(any(), anyString());
    }

    @Test
    void 기록이_실패해도_응답은_돌려준다() {
        when(primary.generate(any(), anyString())).thenReturn(new LlmResult("{}", MODEL, 1, 1, 10, false, null));
        when(recorder.record(any())).thenThrow(new IllegalStateException("db down"));

        LlmResult result = client(false).generate(intent());

        assertThat(result.text()).isEqualTo("{}");
        assertThat(result.callLogId()).isNull();
    }

    @Test
    void 주_모델이_429면_대체_모델로_답하고_둘_다_기록한다() {
        when(primary.generate(any(), anyString())).thenThrow(new LlmException(Kind.RATE_LIMIT, 429, "limit", null));
        when(fallback.generate(any(), eq(FALLBACK_MODEL)))
                .thenReturn(new LlmResult("{}", FALLBACK_MODEL, 800, 30, 1100, false, null));

        LlmResult result = client(true).generate(intent());

        assertThat(result.model()).isEqualTo(FALLBACK_MODEL);
        List<AiCallLog> saved = captured(2);
        assertThat(saved.get(0).getErrorCode()).isEqualTo("RATE_LIMIT");
        assertThat(saved.get(0).getFallback()).isFalse();
        assertThat(saved.get(1).getModel()).isEqualTo(FALLBACK_MODEL);
        assertThat(saved.get(1).getFallback()).isTrue();
        assertThat(saved.get(1).getEstimatedCredits()).isEqualByComparingTo("0.95");
    }

    @Test
    void 주_모델_서킷이_열리면_바로_대체_모델로() {
        GmsLlmClient client = client(true);
        when(primary.generate(any(), anyString())).thenThrow(new LlmException(Kind.UNAVAILABLE, 503, "down", null));
        when(fallback.generate(any(), anyString())).thenReturn(new LlmResult("{}", FALLBACK_MODEL, 1, 1, 10, false, null));

        for (int i = 0; i < 5; i++) {
            assertThat(client.generate(intent()).model()).isEqualTo(FALLBACK_MODEL);
        }

        assertThat(client.state(LlmPurpose.INTENT)).isEqualTo(CircuitBreaker.State.OPEN);
        verify(primary, times(4)).generate(any(), anyString());
        verify(fallback, times(5)).generate(any(), anyString());
    }

    @Test
    void 시간_초과는_대체하지_않는다() {
        when(primary.generate(any(), anyString())).thenThrow(new LlmException(Kind.TIMEOUT, 0, "느림", null));

        assertKind(() -> client(true).generate(intent()), Kind.TIMEOUT);
        verify(fallback, never()).generate(any(), anyString());
    }

    @Test
    void 스트리밍이_시작된_뒤_끊기면_대체하지_않는다() {
        when(primary.stream(any(), anyString(), any())).thenAnswer(invocation -> {
            DeltaHandler handler = invocation.getArgument(2);
            handler.onDelta("첫 문장.");
            throw new LlmException(Kind.UNAVAILABLE, 0, "끊김", null);
        });

        assertKind(() -> client(true).stream(answer(), delta -> true), Kind.UNAVAILABLE);
        verify(fallback, never()).stream(any(), anyString(), any());
    }

    @Test
    void 스트리밍_시작_전_실패는_대체한다() {
        when(primary.stream(any(), anyString(), any())).thenThrow(new LlmException(Kind.UNAVAILABLE, 503, "down", null));
        when(fallback.stream(any(), anyString(), any())).thenReturn(new LlmResult("답", FALLBACK_MODEL, 1, 1, 10, false, null));

        LlmResult result = client(true).stream(answer(), delta -> true);

        assertThat(result.model()).isEqualTo(FALLBACK_MODEL);
    }

    private static LlmRequest intent() {
        return LlmRequest.json(LlmPurpose.INTENT, "s", "u", 200);
    }

    private static LlmRequest answer() {
        return LlmRequest.text(LlmPurpose.ANSWER, "s", "u", 300);
    }

    private List<AiCallLog> captured(int count) {
        ArgumentCaptor<AiCallLog> captor = ArgumentCaptor.forClass(AiCallLog.class);
        verify(recorder, times(count)).record(captor.capture());
        return captor.getAllValues();
    }

    private static void assertKind(Runnable call, Kind kind) {
        assertThatThrownBy(call::run)
                .isInstanceOf(LlmException.class)
                .extracting(e -> ((LlmException) e).getKind())
                .isEqualTo(kind);
    }
}
