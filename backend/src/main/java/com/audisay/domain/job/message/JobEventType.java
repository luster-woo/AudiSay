package com.audisay.domain.job.message;

public enum JobEventType {
    STAGE_STARTED,
    PROGRESS,
    CHUNK_SUCCEEDED,
    STAGE_COMPLETED,
    FAILED
}
