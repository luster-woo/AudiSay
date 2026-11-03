package com.audisay.domain.admin.service;

import com.audisay.domain.admin.dto.response.AiUsageStatsResponse;
import com.audisay.domain.admin.dto.response.AiUsageStatsResponse.DailyUsage;
import com.audisay.domain.admin.dto.response.AiUsageStatsResponse.ModelUsage;
import com.audisay.domain.admin.dto.response.AiUsageStatsResponse.PurposeUsage;
import com.audisay.domain.admin.dto.response.AiUsageStatsResponse.Reuse;
import com.audisay.domain.admin.dto.response.AiUsageStatsResponse.Summary;
import com.audisay.domain.admin.repository.AiLatencyRow;
import com.audisay.domain.admin.repository.AiUsageRow;
import com.audisay.domain.admin.repository.AiUsageStatsRepository;
import com.audisay.domain.admin.repository.GenerationResultCountRow;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

@Service
@RequiredArgsConstructor
public class AdminStatsService {
    public static final int MAX_RANGE_DAYS = 92;
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final int CREDIT_SCALE = 2;

    private final AiUsageStatsRepository statsRepository;
    private final AiCreditCalculator creditCalculator;

    /** from·to는 KST 날짜, 양끝 포함 */
    @Transactional(readOnly = true)
    public AiUsageStatsResponse getAiUsage(LocalDate from, LocalDate to) {
        validateRange(from, to);
        Instant start = from.atStartOfDay(KST).toInstant();
        Instant end = to.plusDays(1).atStartOfDay(KST).toInstant();

        List<AiUsageRow> rows = statsRepository.sumByPurposeAndModel(start, end);
        Map<String, Long> p50 = new HashMap<>();
        Map<String, Long> p95 = new HashMap<>();
        for (AiLatencyRow row : statsRepository.latencyByPurpose(start, end)) {
            p50.put(row.getPurpose(), roundMs(row.getP50()));
            p95.put(row.getPurpose(), roundMs(row.getP95()));
        }

        Acc total = new Acc();
        rows.forEach(row -> total.add(row, creditCalculator.credits(row)));
        Summary summary = new Summary(total.calls, total.inputTokens, total.outputTokens, scale(total.credits),
                rate(total.errors, total.calls), rate(total.fallbacks, total.calls));

        List<PurposeUsage> byPurpose = groupBy(rows, AiUsageRow::getGroupKey).entrySet().stream()
                .sorted(byCreditsDesc())
                .map(e -> {
                    Acc a = e.getValue();
                    return new PurposeUsage(e.getKey(), a.calls, a.inputTokens, a.outputTokens, scale(a.credits),
                            rate(a.errors, a.calls), p50.get(e.getKey()), p95.get(e.getKey()));
                })
                .toList();

        List<ModelUsage> byModel = groupBy(rows, AiUsageRow::getModel).entrySet().stream()
                .sorted(byCreditsDesc())
                .map(e -> {
                    Acc a = e.getValue();
                    return new ModelUsage(e.getKey(), a.calls, a.inputTokens, a.outputTokens, scale(a.credits));
                })
                .toList();

        Map<String, Acc> byDay = groupBy(statsRepository.sumByDayAndModel(start, end), AiUsageRow::getGroupKey);
        List<DailyUsage> daily = from.datesUntil(to.plusDays(1))
                .map(date -> {
                    Acc a = byDay.getOrDefault(date.toString(), new Acc());
                    return new DailyUsage(date, a.calls, a.inputTokens, a.outputTokens, scale(a.credits));
                })
                .toList();

        return new AiUsageStatsResponse(from, to, summary, byPurpose, byModel, daily, reuse(start, end));
    }

    private Reuse reuse(Instant start, Instant end) {
        Map<String, Long> counts = new HashMap<>();
        for (GenerationResultCountRow row : statsRepository.countYoutubeRequestsByResult(start, end)) {
            counts.put(row.getResult(), row.getCount());
        }
        long newJob = counts.getOrDefault("NEW_JOB", 0L);
        long reused = counts.getOrDefault("REUSED", 0L);
        long joinedJob = counts.getOrDefault("JOINED_JOB", 0L);

        Instant allTimeEnd = Instant.now().plus(1, ChronoUnit.DAYS);
        long jobs = statsRepository.countYoutubeJobsWithCalls(Instant.EPOCH, allTimeEnd);
        BigDecimal avg = jobs == 0 ? BigDecimal.ZERO
                : sumCredits(statsRepository.sumYoutubeJobCallsByModel(Instant.EPOCH, allTimeEnd))
                .divide(BigDecimal.valueOf(jobs), CREDIT_SCALE, RoundingMode.HALF_UP);
        BigDecimal saved = avg.multiply(BigDecimal.valueOf(reused + joinedJob));
        BigDecimal spent = sumCredits(statsRepository.sumYoutubeJobCallsByModel(start, end));
        BigDecimal denominator = saved.add(spent);
        double savedRate = denominator.signum() == 0 ? 0
                : saved.divide(denominator, 4, RoundingMode.HALF_UP).doubleValue();
        return new Reuse(newJob, reused, joinedJob, avg, scale(saved), savedRate);
    }

    private static void validateRange(LocalDate from, LocalDate to) {
        if (from.isAfter(to)) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "시작일이 종료일보다 늦어요.");
        }
        if (ChronoUnit.DAYS.between(from, to) + 1 > MAX_RANGE_DAYS) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "기간은 " + MAX_RANGE_DAYS + "일까지 조회할 수 있어요.");
        }
    }

    private Map<String, Acc> groupBy(List<AiUsageRow> rows, Function<AiUsageRow, String> key) {
        Map<String, Acc> groups = new LinkedHashMap<>();
        for (AiUsageRow row : rows) {
            groups.computeIfAbsent(key.apply(row), k -> new Acc()).add(row, creditCalculator.credits(row));
        }
        return groups;
    }

    private BigDecimal sumCredits(List<AiUsageRow> rows) {
        return rows.stream().map(creditCalculator::credits).reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    private static Comparator<Map.Entry<String, Acc>> byCreditsDesc() {
        return Comparator.<Map.Entry<String, Acc>, BigDecimal>comparing(e -> e.getValue().credits).reversed()
                .thenComparing(Comparator.<Map.Entry<String, Acc>>comparingLong(e -> e.getValue().calls).reversed());
    }

    private static double rate(long part, long whole) {
        return whole == 0 ? 0 : (double) part / whole;
    }

    private static BigDecimal scale(BigDecimal credits) {
        return credits.setScale(CREDIT_SCALE, RoundingMode.HALF_UP);
    }

    private static Long roundMs(Double ms) {
        return ms == null ? null : Math.round(ms);
    }

    private static final class Acc {
        private long calls;
        private long errors;
        private long fallbacks;
        private long inputTokens;
        private long outputTokens;
        private BigDecimal credits = BigDecimal.ZERO;

        private void add(AiUsageRow row, BigDecimal rowCredits) {
            calls += orZero(row.getCalls());
            errors += orZero(row.getErrors());
            fallbacks += orZero(row.getFallbacks());
            inputTokens += orZero(row.getInputTokens());
            outputTokens += orZero(row.getOutputTokens());
            credits = credits.add(rowCredits);
        }

        private static long orZero(Long value) {
            return value == null ? 0 : value;
        }
    }
}
