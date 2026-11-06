package com.audisay.domain.job.repository;

import com.audisay.domain.job.entity.Job;
import com.audisay.domain.job.entity.JobStatus;
import com.audisay.domain.job.entity.Pipeline;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
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

    /** 예상 시간 계산용: 같은 경로로 최근 끝난 작업(JobTimeEstimator). 영상 길이를 쓰므로 영상을 함께 읽음(N+1 없이) */
    @EntityGraph(attributePaths = "video")
    List<Job> findTop20ByPipelineAndStatusOrderByIdDesc(Pipeline pipeline, JobStatus status);

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
