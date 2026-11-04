package com.audisay.domain.job.repository;

import com.audisay.domain.job.entity.JobChunk;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface JobChunkRepository extends JpaRepository<JobChunk, Long> {

    Optional<JobChunk> findByJob_IdAndChunkIndex(Long jobId, Integer chunkIndex);

    List<JobChunk> findByJob_IdOrderByChunkIndexAsc(Long jobId);

    boolean existsByJob_Id(Long jobId);

    @Query("select max(c.updatedAt) from JobChunk c where c.job.id = :jobId")
    Instant findLastUpdatedAt(@Param("jobId") Long jobId);
}
