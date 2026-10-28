package com.audisay.domain.job.repository;

import com.audisay.domain.job.entity.Job;
import com.audisay.domain.job.entity.JobStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;

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
}
