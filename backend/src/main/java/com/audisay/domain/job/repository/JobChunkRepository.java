package com.audisay.domain.job.repository;

import com.audisay.domain.job.entity.JobChunk;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface JobChunkRepository extends JpaRepository<JobChunk, Long> {

    Optional<JobChunk> findByJob_IdAndChunkIndex(Long jobId, Integer chunkIndex);

    List<JobChunk> findByJob_IdOrderByChunkIndexAsc(Long jobId);

    boolean existsByJob_Id(Long jobId);
}
