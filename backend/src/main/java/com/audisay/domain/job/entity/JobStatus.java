package com.audisay.domain.job.entity;

import java.util.List;

public enum JobStatus {
    QUEUED,
    RUNNING,
    SUCCEEDED,
    PARTIAL,
    FAILED;

    /** 진행 중인 상태. 한 영상에 이 상태의 작업은 하나뿐이다(uq_jobs_active_video) */
    public static final List<JobStatus> ACTIVE = List.of(QUEUED, RUNNING);
}
