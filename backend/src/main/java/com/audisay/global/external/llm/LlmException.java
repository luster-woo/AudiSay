package com.audisay.global.external.llm;

import com.audisay.global.exception.ErrorCode;
import lombok.Getter;

/**
 * LLM 호출 실패. 응답을 받았으면 status가 있고, 연결 실패·시간 초과면 0이다.
 */
@Getter
public class LlmException extends RuntimeException {

    public enum Kind {
        /** 연결 실패·5xx·서킷 열림·키 없음 */
        UNAVAILABLE(true, ErrorCode.CHAT_AI_UNAVAILABLE),
        TIMEOUT(true, ErrorCode.CHAT_AI_TIMEOUT),
        /** 429. 한도 문제라 서킷 브레이커 실패로 세지 않는다 */
        RATE_LIMIT(false, ErrorCode.CHAT_AI_LIMIT),
        /** 안전 정책 거부. 호출한 쪽이 UNKNOWN·UNANSWERABLE로 처리한다 */
        BLOCKED(false, null),
        /** 요청 형식·키 오류, 응답을 읽을 수 없음 */
        INVALID(false, ErrorCode.INTERNAL_SERVER_ERROR);

        private final boolean breakerFailure;
        private final ErrorCode errorCode;

        Kind(boolean breakerFailure, ErrorCode errorCode) {
            this.breakerFailure = breakerFailure;
            this.errorCode = errorCode;
        }

        public boolean countsForBreaker() {
            return breakerFailure;
        }

        /** 공개 API 에러 코드. BLOCKED는 null */
        public ErrorCode errorCode() {
            return errorCode;
        }
    }

    private final Kind kind;
    private final int status;

    public LlmException(Kind kind, int status, String message, Throwable cause) {
        super(message, cause);
        this.kind = kind;
        this.status = status;
    }
}
