package com.audisay.global.response;

import com.audisay.global.exception.ErrorCode;
import com.fasterxml.jackson.annotation.JsonPropertyOrder;
import org.springframework.http.HttpStatus;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.time.Instant;

@JsonPropertyOrder({"statusCode", "timestamp", "path", "message", "data", "error"})
public record ApiResponse<T>(
        int statusCode,
        String timestamp,
        String path,
        String message,
        T data,
        ErrorResponse error
) {
    public static <T> ApiResponse<T> success(String message, T data) {
        return success(HttpStatus.OK, message, data);
    }

    public static ApiResponse<Void> success(String message) {
        return success(HttpStatus.OK, message, null);
    }

    public static <T> ApiResponse<T> success(HttpStatus status, String message, T data) {
        return new ApiResponse<>(status.value(), now(), currentPath(), message, data, null);
    }

    public static ApiResponse<Void> fail(ErrorCode errorCode, String message, String path) {
        return new ApiResponse<>(errorCode.getStatus().value(), now(), path, message, null, ErrorResponse.of(errorCode));
    }

    private static String now() {
        return Instant.now().toString();
    }

    private static String currentPath() {
        if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes) {
            return attributes.getRequest().getRequestURI();
        }
        return null;
    }
}
