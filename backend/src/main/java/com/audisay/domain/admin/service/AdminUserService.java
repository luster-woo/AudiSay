package com.audisay.domain.admin.service;

import com.audisay.domain.admin.dto.response.AdminUserResponse;
import com.audisay.domain.user.entity.Role;
import com.audisay.domain.user.repository.UserRepository;
import com.audisay.global.response.PageResponse;
import com.audisay.global.util.LikePattern;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class AdminUserService {
    private final UserRepository userRepository;

    /**
     * 가입 최신순. keyword는 이메일·이름 일부이고 대소문자를 가리지 않는다. 기본은 탈퇴 회원을 뺀다.
     */
    @Transactional(readOnly = true)
    public PageResponse<AdminUserResponse> getUsers(Role role, String keyword, boolean includeWithdrawn,
                                                    Pageable pageable) {
        return PageResponse.from(userRepository.searchForAdmin(role, LikePattern.contains(keyword), includeWithdrawn, pageable)
                .map(AdminUserResponse::from));
    }
}
