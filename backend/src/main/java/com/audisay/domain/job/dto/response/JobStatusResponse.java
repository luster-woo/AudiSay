package com.audisay.domain.job.dto.response;

import com.audisay.domain.job.dto.JobProgress;
import com.audisay.domain.job.entity.Job;
import com.audisay.domain.job.entity.JobStage;
import com.audisay.domain.job.entity.JobStatus;
import com.audisay.domain.job.entity.JobType;
import com.audisay.domain.job.service.JobTimeEstimator;

import java.time.Instant;

public record JobStatusResponse(
        Long jobId,
        Long videoId,
        JobType jobType,
        JobStatus status,
        JobStage currentStage,
        int progress,
        Integer estimatedRemainingSec,
        Integer estimatedTotalSec,
        Long descriptionId,
        Integer coveredUntilMs,
        String errorCode,
        Boolean retryable,
        Instant queuedAt,
        Instant startedAt,
        Instant finishedAt
) {
    public static JobStatusResponse finished(Job job, Long descriptionId, Integer coveredUntilMs) {
        return new JobStatusResponse(job.getId(), job.getVideo().getId(), job.getJobType(), job.getStatus(),
                job.getCurrentStage(), job.getProgress(), null, null, descriptionId, coveredUntilMs,
                job.getErrorCode(), job.isRetryable(), job.getQueuedAt(), job.getStartedAt(), job.getFinishedAt());
    }

    public static JobStatusResponse inProgress(Job job, JobProgress progress, JobTimeEstimator.Estimate estimate) {
        return new JobStatusResponse(job.getId(), job.getVideo().getId(), job.getJobType(), progress.status(),
                progress.currentStage(), progress.progress(), estimate.remainingSec(), estimate.totalSec(), null, null,
                null, null, job.getQueuedAt(), job.getStartedAt(), null);
    }
}
