package com.audisay.domain.admin.service;

import com.audisay.domain.admin.dto.response.AiUsageStatsResponse;
import com.audisay.domain.admin.repository.AiLatencyRow;
import com.audisay.domain.admin.repository.AiUsageRow;
import com.audisay.domain.admin.repository.AiUsageStatsRepository;
import com.audisay.domain.admin.repository.GenerationResultCountRow;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import com.audisay.global.external.llm.GmsProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AdminStatsServiceTest {
    private static final LocalDate FROM = LocalDate.of(2026, 11, 1);
    private static final LocalDate TO = LocalDate.of(2026, 11, 3);
    private static final Instant START = Instant.parse("2026-10-31T15:00:00Z");
    private static final Instant END = Instant.parse("2026-11-03T15:00:00Z");

    private AiUsageStatsRepository repository;
    private AdminStatsService service;

    @BeforeEach
    void setUp() {
        repository = mock(AiUsageStatsRepository.class);
        GmsProperties properties = new GmsProperties(null, null, null, null, null, null, null, null, null, null,
                Map.of("gemini-3.5-flash", new GmsProperties.Price(new BigDecimal("0.015"), new BigDecimal("0.09")),
                        "gemini-3.8-flash-tts", new GmsProperties.Price(new BigDecimal("0.01"), new BigDecimal("0.18"))),
                null, null, null);
        service = new AdminStatsService(repository, new AiCreditCalculator(properties));
    }

    @Test
    void 크레딧은_토큰_곱하기_단가에_기록된_값을_더하고_크레딧_큰_순으로_준다() {
        when(repository.sumByPurposeAndModel(START, END)).thenReturn(List.of(
                row("DESCRIBE", "gemini-3.5-flash", 2, 0, 0, 19387, 3055, "0"),
                row("INTENT", "claude-haiku-5-5", 3, 1, 3, 100, 10, "1.40"),
                row("TTS", "gemini-3.8-flash-tts", 1, 0, 0, 94, 533, "0"),
                row("STT", "h200:whisper-large-v3", 4, 0, 0, 0, 0, "0"),
                row("STT", "unknown-model", 1, 0, 0, 50, 50, "0")));

        AiUsageStatsResponse result = service.getAiUsage(FROM, TO);

        assertThat(result.summary().calls()).isEqualTo(11);
        assertThat(result.summary().estimatedCredits()).isEqualByComparingTo("664.04");
        assertThat(result.summary().errorRate()).isEqualTo(1.0 / 11);
        assertThat(result.summary().fallbackRate()).isEqualTo(3.0 / 11);
        assertThat(result.byPurpose()).extracting("purpose", "calls", "estimatedCredits")
                .containsExactly(tuple("DESCRIBE", 2L, new BigDecimal("565.76")),
                        tuple("TTS", 1L, new BigDecimal("96.88")),
                        tuple("INTENT", 3L, new BigDecimal("1.40")),
                        tuple("STT", 5L, new BigDecimal("0.00")));
        assertThat(result.byModel()).extracting("model")
                .containsExactly("gemini-3.5-flash", "gemini-3.8-flash-tts", "claude-haiku-5-5",
                        "h200:whisper-large-v3", "unknown-model");
    }

    @Test
    void 용도별_에러율과_지연을_준다() {
        when(repository.sumByPurposeAndModel(START, END)).thenReturn(List.of(
                row("QUESTION", "gemini-3.1-flash-lite", 8, 2, 0, 0, 0, "0"),
                row("TTS", "h200:supertonic", 2, 0, 0, 0, 0, "0")));
        when(repository.latencyByPurpose(START, END)).thenReturn(List.of(latency("QUESTION", 812.4, 1530.6)));

        AiUsageStatsResponse result = service.getAiUsage(FROM, TO);

        assertThat(result.byPurpose()).extracting("purpose", "errorRate", "p50LatencyMs", "p95LatencyMs")
                .containsExactly(tuple("QUESTION", 0.25, 812L, 1531L), tuple("TTS", 0.0, null, null));
    }

    @Test
    void 일별은_호출이_없는_날도_0으로_채운다() {
        when(repository.sumByDayAndModel(START, END)).thenReturn(List.of(
                row("2026-11-02", "gemini-3.8-flash-tts", 5, 0, 0, 94, 533, "0"),
                row("2026-11-02", "claude-haiku-5-5", 1, 0, 1, 0, 0, "0.50")));

        AiUsageStatsResponse result = service.getAiUsage(FROM, TO);

        assertThat(result.daily()).extracting("date", "calls", "estimatedCredits")
                .containsExactly(tuple(FROM, 0L, new BigDecimal("0.00")),
                        tuple(LocalDate.of(2026, 11, 2), 6L, new BigDecimal("97.38")),
                        tuple(TO, 0L, new BigDecimal("0.00")));
    }

    @Test
    void 재사용_절감은_영상당_평균_크레딧으로_계산한다() {
        when(repository.countYoutubeRequestsByResult(START, END)).thenReturn(List.of(
                count("NEW_JOB", 2), count("REUSED", 3), count("JOINED_JOB", 1), count("REJECTED", 5)));
        when(repository.countYoutubeJobsWithCalls(eq(Instant.EPOCH), any())).thenReturn(4L);
        when(repository.sumYoutubeJobCallsByModel(eq(Instant.EPOCH), any())).thenReturn(List.of(
                row("JOB", "gemini-3.5-flash", 4, 0, 0, 0, 0, "400")));
        when(repository.sumYoutubeJobCallsByModel(START, END)).thenReturn(List.of(
                row("JOB", "gemini-3.5-flash", 2, 0, 0, 0, 0, "200")));

        AiUsageStatsResponse.Reuse reuse = service.getAiUsage(FROM, TO).reuse();

        assertThat(reuse.newJob()).isEqualTo(2);
        assertThat(reuse.reused()).isEqualTo(3);
        assertThat(reuse.joinedJob()).isEqualTo(1);
        assertThat(reuse.avgCreditsPerVideo()).isEqualByComparingTo("100");
        assertThat(reuse.savedCredits()).isEqualByComparingTo("400");
        assertThat(reuse.savedRate()).isEqualTo(0.6667);
    }

    @Test
    void 끝난_유튜브_작업이_없으면_절감은_0이다() {
        when(repository.countYoutubeRequestsByResult(START, END)).thenReturn(List.of(count("REUSED", 3)));

        AiUsageStatsResponse.Reuse reuse = service.getAiUsage(FROM, TO).reuse();

        assertThat(reuse.avgCreditsPerVideo()).isEqualByComparingTo("0");
        assertThat(reuse.savedCredits()).isEqualByComparingTo("0");
        assertThat(reuse.savedRate()).isZero();
    }

    @Test
    void 기간은_92일까지_조회할_수_있다() {
        assertThat(service.getAiUsage(FROM, FROM.plusDays(91)).daily()).hasSize(92);

        assertThatThrownBy(() -> service.getAiUsage(FROM, FROM.plusDays(92)))
                .isInstanceOf(BusinessException.class)
                .hasMessage("기간은 92일까지 조회할 수 있어요.")
                .extracting("errorCode").isEqualTo(ErrorCode.INVALID_INPUT);
    }

    @Test
    void 시작일이_종료일보다_늦으면_400() {
        assertThatThrownBy(() -> service.getAiUsage(TO, FROM))
                .isInstanceOf(BusinessException.class)
                .hasMessage("시작일이 종료일보다 늦어요.")
                .extracting("errorCode").isEqualTo(ErrorCode.INVALID_INPUT);
    }

    private static AiUsageRow row(String key, String model, long calls, long errors, long fallbacks,
                                  long inputTokens, long outputTokens, String presetCredits) {
        boolean preset = new BigDecimal(presetCredits).signum() > 0;
        return new Row(key, model, calls, errors, fallbacks, inputTokens, outputTokens, new BigDecimal(presetCredits),
                preset ? 0 : inputTokens, preset ? 0 : outputTokens);
    }

    private static AiLatencyRow latency(String purpose, double p50, double p95) {
        return new AiLatencyRow() {
            public String getPurpose() {
                return purpose;
            }

            public Double getP50() {
                return p50;
            }

            public Double getP95() {
                return p95;
            }
        };
    }

    private static GenerationResultCountRow count(String result, long count) {
        return new GenerationResultCountRow() {
            public String getResult() {
                return result;
            }

            public Long getCount() {
                return count;
            }
        };
    }

    private record Row(String groupKey, String model, Long calls, Long errors, Long fallbacks, Long inputTokens,
                       Long outputTokens, BigDecimal presetCredits, Long pricedInputTokens, Long pricedOutputTokens)
            implements AiUsageRow {
        public String getGroupKey() {
            return groupKey;
        }

        public String getModel() {
            return model;
        }

        public Long getCalls() {
            return calls;
        }

        public Long getErrors() {
            return errors;
        }

        public Long getFallbacks() {
            return fallbacks;
        }

        public Long getInputTokens() {
            return inputTokens;
        }

        public Long getOutputTokens() {
            return outputTokens;
        }

        public BigDecimal getPresetCredits() {
            return presetCredits;
        }

        public Long getPricedInputTokens() {
            return pricedInputTokens;
        }

        public Long getPricedOutputTokens() {
            return pricedOutputTokens;
        }
    }
}
