package com.audisay.domain.job.dto.response;

import com.audisay.domain.job.entity.JobStatus;

public record JobCompletedEvent(JobStatus status, Long descriptionId, Integer coveredUntilMs) {
}
