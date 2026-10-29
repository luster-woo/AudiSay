package com.audisay.domain.job.dto.response;

import com.audisay.domain.job.entity.JobStatus;

public record JobFailedEvent(JobStatus status, String errorCode, Boolean retryable, String message) {
}
