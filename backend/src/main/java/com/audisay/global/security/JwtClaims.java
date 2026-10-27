package com.audisay.global.security;

import com.audisay.domain.user.entity.Role;

import java.time.Instant;

/**
 * 검증을 통과한 토큰의 내용. RefreshToken은 역할을 담지 않으므로 role이 null이다.
 */
public record JwtClaims(Long userId, String sid, Role role, Instant expiresAt) {
    public AuthUser toAuthUser() {
        return new AuthUser(userId, role, sid);
    }
}
