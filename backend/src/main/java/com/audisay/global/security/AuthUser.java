package com.audisay.global.security;

import com.audisay.domain.user.entity.Role;

/**
 * 인증된 요청의 principal. 컨트롤러에서 {@code @AuthenticationPrincipal AuthUser authUser}로 받는다.
 */
public record AuthUser(Long userId, Role role, String sid) {
}
