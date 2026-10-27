package com.audisay.global.security;

import com.audisay.global.exception.ErrorCode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.stereotype.Component;

import java.io.IOException;

/**
 * 인증이 필요한 주소에 인증 없이 들어온 경우. 토큰 만료면 AUTH_003(FE가 재발급 후 재요청), 그 밖은 COMMON_002.
 */
@Component
@RequiredArgsConstructor
public class JwtAuthenticationEntryPoint implements AuthenticationEntryPoint {
    private final SecurityErrorResponder errorResponder;

    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response, AuthenticationException authException)
            throws IOException {
        ErrorCode errorCode = request.getAttribute(JwtAuthenticationFilter.AUTH_ERROR_ATTRIBUTE) instanceof ErrorCode code
                ? code
                : ErrorCode.UNAUTHORIZED;
        errorResponder.write(request, response, errorCode);
    }
}
