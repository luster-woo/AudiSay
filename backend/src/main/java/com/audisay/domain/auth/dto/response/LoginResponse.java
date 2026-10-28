package com.audisay.domain.auth.dto.response;

import com.audisay.domain.user.entity.Role;
import com.audisay.domain.user.entity.User;

public record LoginResponse(String accessToken, String tokenType, long expiresIn, LoginUser user) {
    public static LoginResponse of(AccessTokenResponse token, User user, boolean tutorialCompleted) {
        return new LoginResponse(
                token.accessToken(),
                token.tokenType(),
                token.expiresIn(),
                new LoginUser(user.getId(), user.getEmail(), user.getName(), user.getRole(), tutorialCompleted)
        );
    }

    public record LoginUser(Long userId, String email, String name, Role role, boolean tutorialCompleted) {
    }
}
