package com.audisay.domain.job.message;

import com.audisay.domain.job.entity.JobStage;

import java.util.Map;

public record JobEvent(
        JobEventType event,
        JobStage stage,
        Integer chunkIndex,
        Integer progress,
        Map<String, Object> result,
        String errorCode,
        String errorDetail,
        String workerId
) {
}
