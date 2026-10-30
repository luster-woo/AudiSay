package com.audisay.domain.job.dto.response;

import com.audisay.domain.job.entity.JobStage;
import com.audisay.domain.job.entity.JobStatus;

public record JobProgressEvent(JobStatus status, JobStage currentStage, int progress, Integer estimatedRemainingSec) {
}
