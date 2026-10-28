package com.audisay.domain.auth.controller;

import com.audisay.domain.auth.dto.request.EmailAvailabilityRequest;
import com.audisay.domain.auth.dto.request.LoginRequest;
import com.audisay.domain.auth.dto.request.SignupRequest;
import com.audisay.domain.auth.dto.response.AccessTokenResponse;
import com.audisay.domain.auth.dto.response.EmailAvailabilityResponse;
import com.audisay.domain.auth.dto.response.LoginResponse;
import com.audisay.domain.auth.dto.response.SignupResponse;
import com.audisay.domain.auth.service.AuthService;
import com.audisay.domain.auth.service.AuthTokens;
import com.audisay.global.response.ApiResponse;
import com.audisay.global.security.JwtProvider;
import com.audisay.global.security.RefreshTokenCookieProvider;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "인증 / 계정")
@RestController
@RequestMapping("/v1/auth")
@RequiredArgsConstructor
public class AuthController {
    private final AuthService authService;
    private final RefreshTokenCookieProvider refreshTokenCookieProvider;

    @Operation(summary = "회원가입")
    @PostMapping("/signup")
    public ResponseEntity<ApiResponse<SignupResponse>> signup(@Valid @RequestBody SignupRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.success(HttpStatus.CREATED, "회원가입 성공", authService.signup(request)));
    }

    @Operation(summary = "이메일 중복 확인")
    @GetMapping("/email/availability")
    public ApiResponse<EmailAvailabilityResponse> checkEmailAvailability(@Valid @ModelAttribute EmailAvailabilityRequest request) {
        return ApiResponse.success("이메일 중복 확인 성공", authService.checkEmailAvailability(request.email()));
    }

    @Operation(summary = "로그인", description = "AccessToken은 본문, RefreshToken은 HttpOnly 쿠키로 준다.")
    @PostMapping("/login")
    public ResponseEntity<ApiResponse<LoginResponse>> login(@Valid @RequestBody LoginRequest request) {
        AuthTokens<LoginResponse> result = authService.login(request);
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, refreshTokenCookieProvider.create(result.refreshToken()).toString())
                .body(ApiResponse.success("로그인 성공", result.body()));
    }

    @Operation(summary = "로그아웃", description = "만료된 토큰으로 불러도 200이고 쿠키를 지운다.")
    @PostMapping("/logout")
    public ResponseEntity<ApiResponse<Void>> logout(
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
            @CookieValue(value = RefreshTokenCookieProvider.COOKIE_NAME, required = false) String refreshToken) {
        authService.logout(JwtProvider.resolveBearerToken(authorization).orElse(null), refreshToken);
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, refreshTokenCookieProvider.expire().toString())
                .body(ApiResponse.success("로그아웃 성공"));
    }

    @Operation(summary = "AccessToken 재발급", description = "RefreshToken 쿠키로 새 AccessToken을 받고, RefreshToken도 새로 바꾼다.")
    @PostMapping("/reissue")
    public ResponseEntity<ApiResponse<AccessTokenResponse>> reissue(
            @CookieValue(value = RefreshTokenCookieProvider.COOKIE_NAME, required = false) String refreshToken) {
        AuthTokens<AccessTokenResponse> result = authService.reissue(refreshToken);
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, refreshTokenCookieProvider.create(result.refreshToken()).toString())
                .body(ApiResponse.success("토큰 재발급 성공", result.body()));
    }
}
