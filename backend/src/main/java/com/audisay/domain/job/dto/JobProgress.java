package com.audisay.domain.job.dto;

import com.audisay.domain.job.entity.Job;
import com.audisay.domain.job.entity.JobStage;
import com.audisay.domain.job.entity.JobStatus;

import java.time.Instant;

public record JobProgress(
        JobStatus status,
        JobStage currentStage,
        int progress,
        Instant updatedAt
) {
    public static JobProgress from(Job job) {
        return new JobProgress(job.getStatus(), job.getCurrentStage(), job.getProgress(), Instant.now());
    }
}
