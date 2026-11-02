package com.audisay.domain.user.service;

import com.audisay.domain.auth.dto.response.AccessTokenResponse;
import com.audisay.domain.auth.service.AuthService;
import com.audisay.domain.user.dto.request.PasswordChangeRequest;
import com.audisay.domain.user.dto.request.WithdrawRequest;
import com.audisay.domain.user.dto.response.MeResponse;
import com.audisay.domain.user.dto.response.VerificationResponse;
import com.audisay.domain.user.entity.Role;
import com.audisay.domain.user.entity.User;
import com.audisay.domain.user.repository.UserRepository;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import com.audisay.global.security.AuthUser;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.time.Instant;

@Service
@RequiredArgsConstructor
public class UserService {
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final AuthService authService;
    private final VerificationDocumentValidator verificationDocumentValidator;

    /**
     * 탈퇴하지 않은 회원. 탈퇴 직후 다른 기기에 남은 토큰으로 들어와도 여기서 막힌다.
     */
    @Transactional(readOnly = true)
    public User getActiveUser(Long userId) {
        return userRepository.findById(userId)
                .filter(user -> !user.isWithdrawn())
                .orElseThrow(() -> new BusinessException(ErrorCode.USER_NOT_FOUND));
    }

    @Transactional(readOnly = true)
    public MeResponse getMe(Long userId) {
        return MeResponse.from(getActiveUser(userId));
    }

    /**
     * 행은 지우지 않고 탈퇴 시각만 남긴다(이용 기록·신고 근거 보존). 같은 이메일로 다시 가입할 수 있다.
     */
    @Transactional
    public void withdraw(AuthUser authUser, WithdrawRequest request) {
        User user = getActiveUser(authUser.userId());
        checkPassword(user, request.password(), ErrorCode.PASSWORD_MISMATCH.getMessage());
        user.withdraw(Instant.now());
        authService.revokeAllSessions(user.getId(), authUser.sid());
    }

    /**
     * 지금 기기는 그대로 쓰고, 다른 기기는 바로 로그아웃된다.
     */
    @Transactional
    public void changePassword(AuthUser authUser, PasswordChangeRequest request) {
        User user = getActiveUser(authUser.userId());
        checkPassword(user, request.currentPassword(), "현재 비밀번호가 일치하지 않습니다.");
        user.changePassword(passwordEncoder.encode(request.newPassword()));
        authService.revokeOtherSessions(user.getId(), authUser.sid());
    }

    /**
     * 시각장애인 인증(형식상 자동 승인). 서류는 형식·용량만 검사하고 어디에도 저장하지 않는다.
     * 일반 회원만 신청할 수 있다. 관리자가 신청하면 역할이 바뀌어 관리자 권한을 잃으므로 함께 막는다.
     */
    @Transactional
    public VerificationResponse verifyVisuallyImpaired(AuthUser authUser, MultipartFile document, Boolean sensitiveAgreed) {
        if (!Boolean.TRUE.equals(sensitiveAgreed)) {
            throw new BusinessException(ErrorCode.SENSITIVE_INFO_NOT_AGREED);
        }
        User user = getActiveUser(authUser.userId());
        if (user.getRole() != Role.GENERAL) {
            throw new BusinessException(ErrorCode.ALREADY_VERIFIED);
        }
        verificationDocumentValidator.validate(document);

        user.verifyVisuallyImpaired(Instant.now());
        AccessTokenResponse token = authService.issueAccessToken(user, authUser.sid());
        return VerificationResponse.of(user, token);
    }

    private void checkPassword(User user, String rawPassword, String message) {
        if (!passwordEncoder.matches(rawPassword, user.getPasswordHash())) {
            throw new BusinessException(ErrorCode.PASSWORD_MISMATCH, message);
        }
    }
}
