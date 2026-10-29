package com.audisay.domain.job.dto.response;

import com.audisay.domain.job.dto.JobProgress;
import com.audisay.domain.job.entity.Job;
import com.audisay.domain.job.entity.JobStage;
import com.audisay.domain.job.entity.JobStatus;
import com.audisay.domain.job.entity.JobType;

import java.time.Instant;

public record JobStatusResponse(
        Long jobId,
        Long videoId,
        JobType jobType,
        JobStatus status,
        JobStage currentStage,
        int progress,
        Integer estimatedRemainingSec,
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
                job.getCurrentStage(), job.getProgress(), null, descriptionId, coveredUntilMs,
                job.getErrorCode(), job.isRetryable(), job.getQueuedAt(), job.getStartedAt(), job.getFinishedAt());
    }

    public static JobStatusResponse inProgress(Job job, JobProgress progress) {
        return new JobStatusResponse(job.getId(), job.getVideo().getId(), job.getJobType(), progress.status(),
                progress.currentStage(), progress.progress(), null, null, null,
                null, null, job.getQueuedAt(), job.getStartedAt(), null);
    }
}
