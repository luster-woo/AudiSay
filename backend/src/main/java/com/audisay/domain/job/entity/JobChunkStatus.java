package com.audisay.domain.job.entity;

public enum JobChunkStatus {
    PENDING,
    RUNNING,
    SUCCEEDED,
    FAILED,
    DEAD;

    public boolean isFinished() {
        return this == SUCCEEDED || this == FAILED || this == DEAD;
    }
}
