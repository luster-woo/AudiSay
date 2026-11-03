package com.audisay.global.external.ai;

import lombok.Getter;

/**
 * AI 서버 호출 실패. 응답을 받았으면 status·code가 있고, 연결 실패·시간 초과면 status 0이다.
 */
@Getter
public class AiServerException extends RuntimeException {
    public enum Kind { RESPONSE, TIMEOUT, UNAVAILABLE }

    private final Kind kind;
    private final int status;
    private final String code;

    public AiServerException(Kind kind, int status, String code, String message, Throwable cause) {
        super(message, cause);
        this.kind = kind;
        this.status = status;
        this.code = code;
    }
}
