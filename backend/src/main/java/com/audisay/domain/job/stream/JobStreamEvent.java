package com.audisay.domain.job.stream;

import com.audisay.domain.job.dto.JobNotice;
import com.audisay.domain.job.dto.response.JobCompletedEvent;
import com.audisay.domain.job.dto.response.JobFailedEvent;
import com.audisay.domain.job.dto.response.JobProgressEvent;
import com.audisay.domain.job.dto.response.JobStatusResponse;
import com.audisay.domain.job.entity.JobStage;
import com.audisay.domain.job.entity.JobStatus;

/** SSE로 보낼 이벤트 하나. name은 progress / completed / failed */
record JobStreamEvent(String name, JobStage stage, int progress, Object data) {
    static final String PROGRESS = "progress";
    static final String COMPLETED = "completed";
    static final String FAILED = "failed";

    boolean isFinished() {
        return !PROGRESS.equals(name);
    }

    static JobStreamEvent from(JobStatusResponse s) {
        return switch (s.status()) {
            case SUCCEEDED, PARTIAL -> completed(s.status(), s.currentStage(), s.descriptionId(), s.coveredUntilMs());
            case FAILED -> failed(s.currentStage(), s.progress(), s.errorCode(), s.retryable());
            case QUEUED, RUNNING -> new JobStreamEvent(PROGRESS, s.currentStage(), s.progress(),
                    new JobProgressEvent(s.status(), s.currentStage(), s.progress(), s.estimatedRemainingSec()));
        };
    }

    static JobStreamEvent from(JobNotice n) {
        return switch (n.event()) {
            case JobNotice.COMPLETED -> completed(n.status(), n.currentStage(), n.descriptionId(), n.coveredUntilMs());
            case JobNotice.FAILED -> failed(n.currentStage(), n.progress(), n.errorCode(), n.retryable());
            default -> new JobStreamEvent(PROGRESS, n.currentStage(), n.progress(),
                    new JobProgressEvent(n.status(), n.currentStage(), n.progress(), null));
        };
    }

    private static JobStreamEvent completed(JobStatus status, JobStage stage, Long descriptionId, Integer coveredUntilMs) {
        return new JobStreamEvent(COMPLETED, stage, 100, new JobCompletedEvent(status, descriptionId, coveredUntilMs));
    }

    private static JobStreamEvent failed(JobStage stage, int progress, String errorCode, Boolean retryable) {
        return new JobStreamEvent(FAILED, stage, progress,
                new JobFailedEvent(JobStatus.FAILED, errorCode, retryable, JobFailureMessage.of(errorCode)));
    }
}
