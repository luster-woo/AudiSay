package com.audisay.domain.auth.service;

import com.audisay.domain.auth.dto.request.LoginRequest;
import com.audisay.domain.auth.dto.request.SignupRequest;
import com.audisay.domain.auth.dto.response.AccessTokenResponse;
import com.audisay.domain.auth.dto.response.EmailAvailabilityResponse;
import com.audisay.domain.auth.dto.response.LoginResponse;
import com.audisay.domain.auth.dto.response.SignupResponse;
import com.audisay.domain.auth.repository.RefreshTokenRepository;
import com.audisay.domain.user.entity.User;
import com.audisay.domain.user.entity.UserSettings;
import com.audisay.domain.user.repository.UserRepository;
import com.audisay.domain.user.repository.UserSettingsRepository;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import com.audisay.global.security.AccessTokenBlacklist;
import com.audisay.global.security.JwtClaims;
import com.audisay.global.security.JwtProvider;
import io.jsonwebtoken.JwtException;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.HashSet;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class AuthService {
    private final UserRepository userRepository;
    private final UserSettingsRepository userSettingsRepository;
    private final RefreshTokenRepository refreshTokenRepository;
    private final AccessTokenBlacklist accessTokenBlacklist;
    private final JwtProvider jwtProvider;
    private final PasswordEncoder passwordEncoder;

    @Transactional
    public SignupResponse signup(SignupRequest request) {
        String email = normalizeEmail(request.email());
        if (userRepository.existsByEmailAndWithdrawnAtIsNull(email)) {
            throw new BusinessException(ErrorCode.DUPLICATE_EMAIL);
        }

        User user = User.create(email, passwordEncoder.encode(request.password()), request.name().strip());
        try {
            userRepository.saveAndFlush(user);
        } catch (DataIntegrityViolationException e) {
            // 동시에 같은 이메일로 가입해 uq_users_email_active에 걸린 경우
            throw new BusinessException(ErrorCode.DUPLICATE_EMAIL);
        }
        userSettingsRepository.save(UserSettings.createDefault(user));
        return SignupResponse.from(user);
    }

    @Transactional(readOnly = true)
    public EmailAvailabilityResponse checkEmailAvailability(String email) {
        String normalized = normalizeEmail(email);
        return new EmailAvailabilityResponse(normalized, !userRepository.existsByEmailAndWithdrawnAtIsNull(normalized));
    }

    @Transactional(readOnly = true)
    public AuthTokens<LoginResponse> login(LoginRequest request) {
        User user = userRepository.findByEmailAndWithdrawnAtIsNull(normalizeEmail(request.email()))
                .filter(found -> passwordEncoder.matches(request.password(), found.getPasswordHash()))
                .orElseThrow(() -> new BusinessException(ErrorCode.LOGIN_FAILED));
        boolean tutorialCompleted = userSettingsRepository.findById(user.getId())
                .map(UserSettings::isTutorialCompleted)
                .orElseThrow(() -> new IllegalStateException("재생 설정이 없는 회원입니다. userId=" + user.getId()));

        // 로그인할 때마다 새 기기(sid)로 본다
        AuthTokens<AccessTokenResponse> tokens = issueTokens(user, UUID.randomUUID().toString());
        return new AuthTokens<>(LoginResponse.of(tokens.body(), user, tutorialCompleted), tokens.refreshToken());
    }

    /**
     * 이 기기(sid)의 RefreshToken만 지우고 AccessToken은 남은 시간 동안 막는다.
     * 토큰이 없거나 만료돼도 실패하지 않는다(컨트롤러는 항상 쿠키를 지우고 200).
     */
    public void logout(String accessToken, String refreshToken) {
        parseQuietly(accessToken, jwtProvider::parseAccessToken).ifPresent(claims -> {
            refreshTokenRepository.delete(claims.userId(), claims.sid());
            accessTokenBlacklist.add(claims.sid(), Duration.between(Instant.now(), claims.expiresAt()));
        });
        // AccessToken이 이미 만료됐어도 쿠키의 RefreshToken으로 같은 기기의 토큰을 지운다
        parseQuietly(refreshToken, jwtProvider::parseRefreshToken)
                .ifPresent(claims -> refreshTokenRepository.delete(claims.userId(), claims.sid()));
    }

    @Transactional(readOnly = true)
    public AuthTokens<AccessTokenResponse> reissue(String refreshToken) {
        JwtClaims claims = parseQuietly(refreshToken, jwtProvider::parseRefreshToken)
                .orElseThrow(() -> new BusinessException(ErrorCode.REFRESH_TOKEN_INVALID));
        // rotation: 이미 한 번 쓴 이전 토큰이면 저장된 값과 달라 거절된다
        if (!refreshTokenRepository.matches(claims.userId(), claims.sid(), refreshToken)) {
            // 저장된 토큰은 있는데 값이 다르면 다른 탭·창이 먼저 바꾼 것이다. 동시 접속은 막되(로그아웃) 이유를 따로 알린다
            throw new BusinessException(refreshTokenRepository.exists(claims.userId(), claims.sid())
                    ? ErrorCode.REFRESH_TOKEN_REPLACED : ErrorCode.REFRESH_TOKEN_INVALID);
        }
        // 역할이 바뀌었을 수 있으므로(시각장애인 인증) 회원을 다시 읽어 새 역할을 담는다
        User user = userRepository.findById(claims.userId())
                .filter(found -> !found.isWithdrawn())
                .orElseThrow(() -> new BusinessException(ErrorCode.REFRESH_TOKEN_INVALID));
        return issueTokens(user, claims.sid());
    }

    /**
     * 같은 기기(sid)로 AccessToken만 새로 발급한다. 역할이 바뀌었을 때(시각장애인 인증) 쓴다.
     * RefreshToken은 그대로 두며, 재발급할 때 DB의 최신 역할이 담긴다.
     */
    public AccessTokenResponse issueAccessToken(User user, String sid) {
        String accessToken = jwtProvider.createAccessToken(user.getId(), user.getRole(), sid);
        return AccessTokenResponse.of(accessToken, jwtProvider.getAccessTokenExpiration().toSeconds());
    }

    /**
     * 탈퇴: 지금 기기를 포함한 모든 기기를 바로 로그아웃시킨다.
     */
    public void revokeAllSessions(Long userId, String currentSid) {
        Set<String> sids = new HashSet<>(refreshTokenRepository.findSids(userId));
        sids.add(currentSid);
        sids.forEach(sid -> revokeSession(userId, sid));
    }

    /**
     * 비밀번호 변경: 지금 기기만 남기고 다른 기기를 바로 로그아웃시킨다.
     */
    public void revokeOtherSessions(Long userId, String keepSid) {
        refreshTokenRepository.findSids(userId).stream()
                .filter(sid -> !sid.equals(keepSid))
                .forEach(sid -> revokeSession(userId, sid));
    }

    /**
     * RefreshToken을 지워 재발급을 막고, 그 기기가 들고 있는 AccessToken도 블랙리스트로 바로 막는다.
     * AccessToken의 남은 시간을 알 수 없으므로 최대 유효 시간만큼 막는다.
     */
    private void revokeSession(Long userId, String sid) {
        refreshTokenRepository.delete(userId, sid);
        accessTokenBlacklist.add(sid, jwtProvider.getAccessTokenExpiration());
    }

    private AuthTokens<AccessTokenResponse> issueTokens(User user, String sid) {
        String accessToken = jwtProvider.createAccessToken(user.getId(), user.getRole(), sid);
        String refreshToken = jwtProvider.createRefreshToken(user.getId(), sid);
        refreshTokenRepository.save(user.getId(), sid, refreshToken, jwtProvider.getRefreshTokenExpiration());
        AccessTokenResponse body = AccessTokenResponse.of(accessToken, jwtProvider.getAccessTokenExpiration().toSeconds());
        return new AuthTokens<>(body, refreshToken);
    }

    private Optional<JwtClaims> parseQuietly(String token, TokenParser parser) {
        if (token == null || token.isBlank()) {
            return Optional.empty();
        }
        try {
            return Optional.of(parser.parse(token));
        } catch (JwtException e) {
            return Optional.empty();
        }
    }

    private String normalizeEmail(String email) {
        return email.strip().toLowerCase(Locale.ROOT);
    }

    @FunctionalInterface
    private interface TokenParser {
        JwtClaims parse(String token);
    }
}
