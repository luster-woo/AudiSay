package com.audisay.domain.job.repository;

import com.audisay.domain.job.entity.Job;
import com.audisay.domain.job.entity.JobStatus;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface JobRepository extends JpaRepository<Job, Long> {

    List<Job> findByVideo_IdInAndStatusIn(Collection<Long> videoIds, Collection<JobStatus> statuses);

    /**
     * 영상마다 가장 최근 작업 하나.
     */
    @Query("""
            select j from Job j
            where j.video.id in :videoIds
              and j.id = (select max(j2.id) from Job j2 where j2.video = j.video)
            """)
    List<Job> findLatestByVideoIds(@Param("videoIds") Collection<Long> videoIds);

    /**
     * 예상 시간 계산용(JobTimeEstimator): 같은 경로로 최근 성공한 작업 20개의 단계 경계 시각(epoch 초).
     * 단계 경계는 Spring이 다음 단계 메시지를 만든 시각(outbox) — 분석 = 시작 → 첫 조각 해설 메시지, 조각 해설 → 합치기 메시지,
     * 합치기 → 음성 메시지, 음성 → 끝
     */
    @Query(value = """
            WITH recent AS (
                SELECT j.id, v.duration_sec, j.started_at, j.finished_at
                FROM jobs j JOIN videos v ON v.id = j.video_id
                WHERE j.pipeline = :pipeline AND j.status = 'SUCCEEDED'
                  AND j.started_at IS NOT NULL AND j.finished_at IS NOT NULL
                ORDER BY j.id DESC
                LIMIT 20
            ), marks AS (
                SELECT o.body ->> 'jobId' AS job_id, o.routing_key, min(o.created_at) AS created_at
                FROM outbox_messages o
                WHERE o.routing_key IN ('job.describe', 'job.merge', 'job.tts')
                  AND o.body ->> 'jobId' IN (SELECT id::text FROM recent)
                GROUP BY 1, 2
            )
            SELECT r.duration_sec AS durationSec,
                   EXTRACT(EPOCH FROM r.started_at) AS startedAt,
                   EXTRACT(EPOCH FROM (SELECT created_at FROM marks WHERE job_id = r.id::text AND routing_key = 'job.describe')) AS describeAt,
                   EXTRACT(EPOCH FROM (SELECT created_at FROM marks WHERE job_id = r.id::text AND routing_key = 'job.merge')) AS mergeAt,
                   EXTRACT(EPOCH FROM (SELECT created_at FROM marks WHERE job_id = r.id::text AND routing_key = 'job.tts')) AS ttsAt,
                   EXTRACT(EPOCH FROM r.finished_at) AS finishedAt
            FROM recent r
            """, nativeQuery = true)
    List<StageTimes> findRecentStageTimes(@Param("pipeline") String pipeline);

    interface StageTimes {
        Integer getDurationSec();

        Double getStartedAt();

        Double getDescribeAt();

        Double getMergeAt();

        Double getTtsAt();

        Double getFinishedAt();
    }

    /**
     * 멈춘 작업 후보(StaleJobCleaner). 마지막 활동은 서비스에서 잠근 뒤 다시 본다.
     * afterId 뒤부터 id 순서로(아직 활동 중인 오래된 작업이 앞을 채워도 뒤 후보까지 차례가 오게)
     */
    @Query("""
            select j.id from Job j
            where j.id > :afterId
              and ((j.status = :queued and j.queuedAt < :queuedBefore)
                or (j.status = :running and coalesce(j.startedAt, j.queuedAt) < :runningBefore))
            order by j.id
            """)
    List<Long> findStaleCandidateIds(@Param("queued") JobStatus queued,
                                     @Param("queuedBefore") Instant queuedBefore,
                                     @Param("running") JobStatus running,
                                     @Param("runningBefore") Instant runningBefore,
                                     @Param("afterId") Long afterId,
                                     Pageable pageable);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select j from Job j where j.id = :id")
    Optional<Job> findByIdForUpdate(@Param("id") Long id);
}
