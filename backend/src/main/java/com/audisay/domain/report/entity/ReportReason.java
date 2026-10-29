package com.audisay.domain.report.entity;

public enum ReportReason {
    /** 틀린 내용 */
    WRONG,
    /** 중요한 내용 빠짐 */
    MISSING,
    /** 대사와 겹침 */
    OVERLAP,
    /** 기타 (reasonDetail 필수) */
    OTHER
}
