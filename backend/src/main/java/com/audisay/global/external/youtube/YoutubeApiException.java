package com.audisay.global.external.youtube;

/**
 * 유튜브 호출 실패. 하루 한도(quotaExceeded)를 넘긴 경우를 따로 알 수 있다.
 */
public class YoutubeApiException extends RuntimeException {
    private final boolean quotaExceeded;

    public YoutubeApiException(String message, boolean quotaExceeded, Throwable cause) {
        super(message, cause);
        this.quotaExceeded = quotaExceeded;
    }

    public boolean isQuotaExceeded() {
        return quotaExceeded;
    }
}
