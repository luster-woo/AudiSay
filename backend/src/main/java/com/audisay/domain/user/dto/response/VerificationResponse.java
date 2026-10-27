package com.audisay.domain.user.dto.response;

import com.audisay.domain.auth.dto.response.AccessTokenResponse;
import com.audisay.domain.user.entity.Role;
import com.audisay.domain.user.entity.User;

import java.time.Instant;

/**
 * 역할이 바뀌었으므로 새 역할이 담긴 AccessToken을 함께 준다. FE는 이 토큰으로 바꾼다.
 */
public record VerificationResponse(
        Role role,
        Instant verifiedAt,
        String accessToken,
        String tokenType,
        long expiresIn
) {
    public static VerificationResponse of(User user, AccessTokenResponse token) {
        return new VerificationResponse(
                user.getRole(),
                user.getVerifiedAt(),
                token.accessToken(),
                token.tokenType(),
                token.expiresIn()
        );
    }
}
