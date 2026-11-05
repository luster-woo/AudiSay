package com.audisay.domain.admin.repository;

import com.audisay.domain.chat.entity.ChatLog;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;

/**
 * 관리자 챗봇 품질 통계. 기간은 [from, to). chat_logs에 created_at 인덱스가 없어 기간 안을 훑는다(행이 많아지면 인덱스 추가)
 */
public interface ChatStatsRepository extends Repository<ChatLog, Long> {

    /** intent별 입력 수와 분류 시간 p50·p95 */
    @Query(nativeQuery = true, value = """
            select c.intent as "intent", count(*) as "count",
                   percentile_cont(0.5) within group (order by c.intent_latency_ms) as "p50",
                   percentile_cont(0.95) within group (order by c.intent_latency_ms) as "p95"
            from chat_logs c
            where c.created_at >= :from and c.created_at < :to
            group by c.intent
            """)
    List<IntentRow> countByIntent(@Param("from") Instant from, @Param("to") Instant to);

    /** 끝까지 간 답변의 intent·근거별 수. futureOffered = "지금 이후에 나와요, 들으시겠어요?"를 읽은 답변 */
    @Query(nativeQuery = true, value = """
            select c.intent as "intent", c.answer_source as "answerSource", count(*) as "count",
                   count(*) filter (where c.answer_text = :futurePrompt) as "futureOffered"
            from chat_logs c
            where c.created_at >= :from and c.created_at < :to
              and c.intent in ('QUESTION', 'SCENE_NOW', 'RECAP') and c.answer_source is not null
            group by c.intent, c.answer_source
            """)
    List<AnswerRow> countAnswers(@Param("from") Instant from, @Param("to") Instant to,
                                 @Param("futurePrompt") String futurePrompt);

    /** 끝까지 간 답변의 첫 음성 p50·p95 */
    @Query(nativeQuery = true, value = """
            select c.intent as "intent",
                   percentile_cont(0.5) within group (order by c.first_audio_ms) as "p50",
                   percentile_cont(0.95) within group (order by c.first_audio_ms) as "p95"
            from chat_logs c
            where c.created_at >= :from and c.created_at < :to
              and c.answer_source is not null and c.first_audio_ms is not null
            group by c.intent
            """)
    List<LatencyRow> firstAudioByIntent(@Param("from") Instant from, @Param("to") Instant to);

    /** 장면 찾기 방법(KEYWORD / LLM / null = 못 찾음) */
    @Query(nativeQuery = true, value = """
            select c.seek_source as "seekSource", count(*) as "count"
            from chat_logs c
            where c.created_at >= :from and c.created_at < :to and c.intent = 'SEEK_SCENE'
            group by c.seek_source
            """)
    List<SeekRow> countSeekSources(@Param("from") Instant from, @Param("to") Instant to);

    /** 어디에도 답이 없던 질문(뒤에 답이 있던 질문은 뺌), 최근순. 회원 정보는 넣지 않는다 */
    @Query(nativeQuery = true, value = """
            select c.id as "chatLogId", c.video_id as "videoId", v.title as "videoTitle", c.video_time_ms as "videoTimeMs",
                   c.utterance as "utterance",
                   to_char(c.created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') as "createdAt"
            from chat_logs c
            left join videos v on v.id = c.video_id
            where c.created_at >= :from and c.created_at < :to
              and c.intent = 'QUESTION' and c.answer_source = 'UNANSWERABLE'
              and (c.answer_text is null or c.answer_text <> :futurePrompt)
            order by c.id desc
            limit :limit
            """)
    List<UnansweredRow> findUnanswered(@Param("from") Instant from, @Param("to") Instant to,
                                       @Param("futurePrompt") String futurePrompt, @Param("limit") int limit);

    interface IntentRow {
        String getIntent();

        Long getCount();

        Double getP50();

        Double getP95();
    }

    interface AnswerRow {
        String getIntent();

        String getAnswerSource();

        Long getCount();

        Long getFutureOffered();
    }

    interface LatencyRow {
        String getIntent();

        Double getP50();

        Double getP95();
    }

    interface SeekRow {
        String getSeekSource();

        Long getCount();
    }

    interface UnansweredRow {
        Long getChatLogId();

        Long getVideoId();

        String getVideoTitle();

        Integer getVideoTimeMs();

        String getUtterance();

        String getCreatedAt();
    }
}
