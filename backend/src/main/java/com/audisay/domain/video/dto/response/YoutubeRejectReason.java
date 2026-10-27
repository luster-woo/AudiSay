package com.audisay.domain.video.dto.response;

/**
 * 유튜브 사전 확인에서 해설을 만들 수 없는 이유. FE가 이유별 안내 문구를 읽어 준다.
 */
public enum YoutubeRejectReason {
    NOT_FOUND,
    PRIVATE,
    NOT_EMBEDDABLE,
    TOO_LONG,
    AGE_RESTRICTED,
    LIVE
}
