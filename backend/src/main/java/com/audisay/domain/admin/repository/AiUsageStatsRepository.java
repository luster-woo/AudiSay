package com.audisay.domain.admin.repository;

import com.audisay.global.aicall.AiCallLog;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;

/** 관리자 AI 사용량 통계. 기간은 [from, to), ix_ai_call_logs_created_at을 쓴다 */
public interface AiUsageStatsRepository extends Repository<AiCallLog, Long> {

    String METRICS = """
            l.model as "model",
            count(*) as "calls",
            count(l.error_code) as "errors",
            count(*) filter (where l.is_fallback) as "fallbacks",
            coalesce(sum(l.input_tokens), 0) as "inputTokens",
            coalesce(sum(l.output_tokens), 0) as "outputTokens",
            coalesce(sum(l.estimated_credits), 0) as "presetCredits",
            coalesce(sum(l.input_tokens) filter (where l.estimated_credits = 0), 0) as "pricedInputTokens",
            coalesce(sum(l.output_tokens) filter (where l.estimated_credits = 0), 0) as "pricedOutputTokens"
            """;

    /** 해설 생성 작업에 붙은 호출. 조각 호출은 job_id 없이 chunk_id만 있어 조각으로 작업을 찾는다 */
    String YOUTUBE_JOB_CALLS = """
            from ai_call_logs l
            left join job_chunks c on c.id = l.chunk_id
            join jobs j on j.id = coalesce(l.job_id, c.job_id)
            where j.pipeline = 'GEMINI_URL' and j.status in ('SUCCEEDED', 'PARTIAL')
              and l.created_at >= :from and l.created_at < :to
            """;

    /** 용도·모델별. 합계·용도별·모델별은 이것을 묶어 만든다 */
    @Query(nativeQuery = true, value = "select l.purpose as \"groupKey\", " + METRICS + """
            from ai_call_logs l
            where l.created_at >= :from and l.created_at < :to
            group by l.purpose, l.model
            """)
    List<AiUsageRow> sumByPurposeAndModel(@Param("from") Instant from, @Param("to") Instant to);

    /** 날짜(KST)·모델별. 호출이 없는 날은 행이 없다 */
    @Query(nativeQuery = true, value = """
            select to_char(l.created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD') as "groupKey",
            """ + METRICS + """
            from ai_call_logs l
            where l.created_at >= :from and l.created_at < :to
            group by 1, l.model
            """)
    List<AiUsageRow> sumByDayAndModel(@Param("from") Instant from, @Param("to") Instant to);

    /** 성공한 호출의 용도별 지연 */
    @Query(nativeQuery = true, value = """
            select l.purpose as "purpose",
                   percentile_cont(0.5) within group (order by l.latency_ms) as "p50",
                   percentile_cont(0.95) within group (order by l.latency_ms) as "p95"
            from ai_call_logs l
            where l.created_at >= :from and l.created_at < :to
              and l.latency_ms is not null and l.error_code is null
            group by l.purpose
            """)
    List<AiLatencyRow> latencyByPurpose(@Param("from") Instant from, @Param("to") Instant to);

    /** 유튜브 해설 요청 결과별 수(NEW_JOB·JOINED_JOB·REUSED·REJECTED) */
    @Query(nativeQuery = true, value = """
            select g.result as "result", count(*) as "count"
            from generation_requests g
            join videos v on v.id = g.video_id
            where v.source_type = 'YOUTUBE'
              and g.requested_at >= :from and g.requested_at < :to
            group by g.result
            """)
    List<GenerationResultCountRow> countYoutubeRequestsByResult(@Param("from") Instant from, @Param("to") Instant to);

    /** 끝난 유튜브 해설 작업에 쓴 호출, 모델별 */
    @Query(nativeQuery = true, value = "select 'JOB' as \"groupKey\", " + METRICS + YOUTUBE_JOB_CALLS
            + " group by l.model")
    List<AiUsageRow> sumYoutubeJobCallsByModel(@Param("from") Instant from, @Param("to") Instant to);

    /** 위 호출이 붙은 작업 수(영상당 평균의 분모) */
    @Query(nativeQuery = true, value = "select count(distinct j.id) " + YOUTUBE_JOB_CALLS)
    long countYoutubeJobsWithCalls(@Param("from") Instant from, @Param("to") Instant to);
}
