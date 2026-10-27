package com.audisay.domain.video.service;

/**
 * 목록·사전 확인에서 보여 주는 영상의 해설 상태. DB의 descriptions.status와는 다른 값이다.
 */
public enum VideoDescriptionStatus {
    /** 해설 없음 */
    NONE,
    /** 만드는 중 */
    GENERATING,
    /** 공개 해설이 있어 바로 재생할 수 있음 */
    READY,
    /** 마지막 작업이 실패해 해설 다시 요청을 할 수 있음 */
    FAILED
}
