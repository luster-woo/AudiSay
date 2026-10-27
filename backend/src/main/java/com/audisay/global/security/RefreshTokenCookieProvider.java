package com.audisay.global.security;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * RefreshToken 쿠키. 재발급·로그아웃 주소에만 실리도록 Path를 /api/v1/auth로 둔다.
 * 탈퇴처럼 다른 주소에서도 만료 쿠키를 내려보낼 수 있다 (Path가 같으면 브라우저가 지운다).
 */
@Component
@RequiredArgsConstructor
public class RefreshTokenCookieProvider {
    public static final String COOKIE_NAME = "refreshToken";
    private static final String COOKIE_PATH = "/api/v1/auth";

    private final JwtProvider jwtProvider;

    public ResponseCookie create(String refreshToken) {
        return build(refreshToken, jwtProvider.getRefreshTokenExpiration());
    }

    public ResponseCookie expire() {
        return build("", Duration.ZERO);
    }

    private ResponseCookie build(String value, Duration maxAge) {
        return ResponseCookie.from(COOKIE_NAME, value)
                .httpOnly(true)
                .secure(true)
                .sameSite("Strict")
                .path(COOKIE_PATH)
                .maxAge(maxAge)
                .build();
    }
}
