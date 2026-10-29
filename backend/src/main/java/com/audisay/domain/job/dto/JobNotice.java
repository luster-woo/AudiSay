package com.audisay.domain.job.dto;

import com.audisay.domain.job.entity.Job;
import com.audisay.domain.job.entity.JobStage;
import com.audisay.domain.job.entity.JobStatus;

public record JobNotice(
        String event,
        JobStatus status,
        JobStage currentStage,
        int progress,
        Long descriptionId,
        Integer coveredUntilMs,
        String errorCode,
        Boolean retryable
) {
    public static final String PROGRESS = "progress";
    public static final String COMPLETED = "completed";
    public static final String FAILED = "failed";

    public static JobNotice progress(Job job, int progress) {
        return new JobNotice(PROGRESS, job.getStatus(), job.getCurrentStage(), progress, null, null, null, null);
    }

    public static JobNotice completed(Job job, Long descriptionId, Integer coveredUntilMs) {
        return new JobNotice(COMPLETED, job.getStatus(), job.getCurrentStage(), job.getProgress(),
                descriptionId, coveredUntilMs, null, null);
    }

    public static JobNotice failed(Job job) {
        return new JobNotice(FAILED, job.getStatus(), job.getCurrentStage(), job.getProgress(),
                null, null, job.getErrorCode(), job.isRetryable());
    }

    public boolean isFinished() {
        return !PROGRESS.equals(event);
    }
}
