package com.audisay.global.exception;

import com.audisay.global.response.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.validation.FieldError;
import org.springframework.web.HttpMediaTypeNotAcceptableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.async.AsyncRequestNotUsableException;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {
    private static final String STT_PATH = "/v1/stt";

    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<ApiResponse<Void>> handleBusinessException(BusinessException e, HttpServletRequest request) {
        log.warn("[BusinessException] {} {} - {}: {}",
                request.getMethod(), request.getRequestURI(), e.getErrorCode().getCode(), e.getMessage());
        return fail(e.getErrorCode(), e.getMessage(), request);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Void>> handleValidationException(MethodArgumentNotValidException e, HttpServletRequest request) {
        FieldError fieldError = e.getBindingResult().getFieldError();
        // 형식 변환 실패(page=abc 등)의 기본 메시지는 Spring 내부 문구라 내보내지 않는다
        String message = (fieldError != null && !fieldError.isBindingFailure() && fieldError.getDefaultMessage() != null)
                ? fieldError.getDefaultMessage()
                : ErrorCode.INVALID_INPUT.getMessage();
        log.warn("[Validation] {} {} - field={}, message={}",
                request.getMethod(), request.getRequestURI(),
                fieldError != null ? fieldError.getField() : null, message);
        return fail(ErrorCode.INVALID_INPUT, message, request);
    }

    @ExceptionHandler({
            HttpMessageNotReadableException.class,
            MissingServletRequestParameterException.class,
            MethodArgumentTypeMismatchException.class,
            HandlerMethodValidationException.class,
            HttpMediaTypeNotSupportedException.class,
            MissingServletRequestPartException.class,
            MultipartException.class
    })
    public ResponseEntity<ApiResponse<Void>> handleBadRequest(Exception e, HttpServletRequest request) {
        log.warn("[BadRequest] {} {} - {}", request.getMethod(), request.getRequestURI(), e.getMessage());
        return fail(ErrorCode.INVALID_INPUT, ErrorCode.INVALID_INPUT.getMessage(), request);
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<ApiResponse<Void>> handleMaxUploadSize(MaxUploadSizeExceededException e, HttpServletRequest request) {
        log.warn("[MaxUploadSize] {} {} - {}", request.getMethod(), request.getRequestURI(), e.getMessage());
        if (request.getRequestURI().endsWith(STT_PATH)) {
            return fail(ErrorCode.INVALID_AUDIO_FILE, "녹음 파일은 10MB 이하여야 합니다.", request);
        }
        return fail(ErrorCode.INVALID_INPUT, "파일 용량이 제한을 넘습니다.", request);
    }

    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ApiResponse<Void>> handleNotFound(NoResourceFoundException e, HttpServletRequest request) {
        return fail(ErrorCode.API_NOT_FOUND, ErrorCode.API_NOT_FOUND.getMessage(), request);
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ApiResponse<Void>> handleMethodNotAllowed(HttpRequestMethodNotSupportedException e, HttpServletRequest request) {
        return fail(ErrorCode.METHOD_NOT_ALLOWED, ErrorCode.METHOD_NOT_ALLOWED.getMessage(), request);
    }

    /** Accept에 JSON이 없으면 JSON 본문도 못 보내므로 상태만 */
    @ExceptionHandler(HttpMediaTypeNotAcceptableException.class)
    public ResponseEntity<Void> handleNotAcceptable(HttpMediaTypeNotAcceptableException e, HttpServletRequest request) {
        log.warn("[NotAcceptable] {} {} - {}", request.getMethod(), request.getRequestURI(), e.getMessage());
        return ResponseEntity.status(HttpStatus.NOT_ACCEPTABLE).build();
    }

    /** SSE 클라이언트가 끊긴 뒤의 에러 디스패치. 쓸 곳이 없으니 아무것도 하지 않는다(끊길 때마다 ERROR 로그가 남지 않게) */
    @ExceptionHandler(AsyncRequestNotUsableException.class)
    public void handleAsyncNotUsable(AsyncRequestNotUsableException e, HttpServletRequest request) {
        log.debug("[AsyncNotUsable] {} {} - {}", request.getMethod(), request.getRequestURI(), e.getMessage());
    }

    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<ApiResponse<Void>> handleAuthentication(AuthenticationException e, HttpServletRequest request) {
        return fail(ErrorCode.UNAUTHORIZED, ErrorCode.UNAUTHORIZED.getMessage(), request);
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ApiResponse<Void>> handleAccessDenied(AccessDeniedException e, HttpServletRequest request) {
        return fail(ErrorCode.FORBIDDEN, ErrorCode.FORBIDDEN.getMessage(), request);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleException(Exception e, HttpServletRequest request) {
        log.error("[UnhandledException] {} {}", request.getMethod(), request.getRequestURI(), e);
        return fail(ErrorCode.INTERNAL_SERVER_ERROR, ErrorCode.INTERNAL_SERVER_ERROR.getMessage(), request);
    }

    private ResponseEntity<ApiResponse<Void>> fail(ErrorCode errorCode, String message, HttpServletRequest request) {
        return ResponseEntity
                .status(errorCode.getStatus())
                // Accept가 text/event-stream(SSE)이어도 에러는 JSON으로 내보낸다
                .contentType(MediaType.APPLICATION_JSON)
                .body(ApiResponse.fail(errorCode, message, request.getRequestURI()));
    }
}
