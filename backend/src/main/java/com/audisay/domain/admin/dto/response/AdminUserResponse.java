package com.audisay.domain.admin.dto.response;

import com.audisay.domain.user.entity.Role;
import com.audisay.domain.user.entity.User;

import java.time.Instant;

public record AdminUserResponse(
        Long userId,
        String email,
        String name,
        Role role,
        Instant verifiedAt,
        Instant withdrawnAt,
        Instant createdAt
) {
    public static AdminUserResponse from(User user) {
        return new AdminUserResponse(
                user.getId(),
                user.getEmail(),
                user.getName(),
                user.getRole(),
                user.getVerifiedAt(),
                user.getWithdrawnAt(),
                user.getCreatedAt()
        );
    }
}
