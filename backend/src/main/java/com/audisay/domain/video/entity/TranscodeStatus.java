package com.audisay.domain.video.entity;

/** 재생용 파일 변환 상태. 워커의 prepare 완료 이벤트를 받고 Spring이 DONE으로 바꾼다 */
public enum TranscodeStatus {
    PENDING,
    RUNNING,
    DONE,
    FAILED
}
