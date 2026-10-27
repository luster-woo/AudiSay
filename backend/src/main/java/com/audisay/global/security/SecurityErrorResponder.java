package com.audisay.global.security;

import com.audisay.global.exception.ErrorCode;
import com.audisay.global.response.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

/**
 * 시큐리티 필터 단계의 에러는 GlobalExceptionHandler까지 가지 않으므로 같은 봉투 형식을 여기서 직접 쓴다.
 */
@Component
@RequiredArgsConstructor
public class SecurityErrorResponder {
    private final ObjectMapper objectMapper;

    public void write(HttpServletRequest request, HttpServletResponse response, ErrorCode errorCode) throws IOException {
        ApiResponse<Void> body = ApiResponse.fail(errorCode, errorCode.getMessage(), request.getRequestURI());
        response.setStatus(errorCode.getStatus().value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.getWriter().write(objectMapper.writeValueAsString(body));
    }
}
