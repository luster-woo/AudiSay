package com.audisay.domain.user.dto.response;

import com.audisay.domain.user.entity.Role;
import com.audisay.domain.user.entity.User;

import java.time.Instant;

public record MeResponse(
        Long userId,
        String email,
        String name,
        Role role,
        boolean verified,
        Instant verifiedAt,
        Instant createdAt
) {
    public static MeResponse from(User user) {
        return new MeResponse(
                user.getId(),
                user.getEmail(),
                user.getName(),
                user.getRole(),
                user.isVerified(),
                user.getVerifiedAt(),
                user.getCreatedAt()
        );
    }
}
