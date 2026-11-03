package com.audisay.domain.admin.dto.response;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/**
 * 관리자 AI 사용량 통계. 크레딧은 조회 시점 단가표(audisay.gms.prices) × 토큰, H200 호출은 0
 *
 * @param byPurpose 크레딧 큰 순
 * @param byModel   크레딧 큰 순
 * @param daily     날짜(KST) 순, 호출이 없는 날도 0으로
 */
public record AiUsageStatsResponse(LocalDate from, LocalDate to, Summary summary, List<PurposeUsage> byPurpose,
                                   List<ModelUsage> byModel, List<DailyUsage> daily, Reuse reuse) {

    /**
     * @param errorRate    error_code가 있는 호출 비율(0~1)
     * @param fallbackRate 대체 모델 호출 비율(0~1)
     */
    public record Summary(long calls, long inputTokens, long outputTokens, BigDecimal estimatedCredits,
                          double errorRate, double fallbackRate) {
    }

    /** 지연은 성공한 호출만 */
    public record PurposeUsage(String purpose, long calls, long inputTokens, long outputTokens,
                               BigDecimal estimatedCredits, double errorRate, Long p50LatencyMs, Long p95LatencyMs) {
    }

    public record ModelUsage(String model, long calls, long inputTokens, long outputTokens,
                             BigDecimal estimatedCredits) {
    }

    /** @param date YYYY-MM-DD(KST) */
    public record DailyUsage(LocalDate date, long calls, long inputTokens, long outputTokens,
                             BigDecimal estimatedCredits) {
    }

    /**
     * 유튜브 해설 재사용으로 아낀 크레딧
     *
     * @param avgCreditsPerVideo 지금까지 끝난 유튜브 해설 작업 1개에 쓴 평균 크레딧(기간과 관계없음)
     * @param savedCredits       (reused + joinedJob) × avgCreditsPerVideo
     * @param savedRate          savedCredits ÷ (savedCredits + 기간 안에 유튜브 해설 작업에 쓴 크레딧)
     */
    public record Reuse(long newJob, long reused, long joinedJob, BigDecimal avgCreditsPerVideo,
                        BigDecimal savedCredits, double savedRate) {
    }
}
