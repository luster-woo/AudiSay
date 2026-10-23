package com.audisay.global.response;

import com.audisay.global.exception.ErrorCode;

public record ErrorResponse(String code) {
    public static ErrorResponse of(ErrorCode errorCode) {
        return new ErrorResponse(errorCode.getCode());
    }
}
