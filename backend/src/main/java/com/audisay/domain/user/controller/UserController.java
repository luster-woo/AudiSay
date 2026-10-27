package com.audisay.domain.user.controller;

import com.audisay.domain.user.dto.request.PasswordChangeRequest;
import com.audisay.domain.user.dto.request.SettingsUpdateRequest;
import com.audisay.domain.user.dto.request.WithdrawRequest;
import com.audisay.domain.user.dto.response.MeResponse;
import com.audisay.domain.user.dto.response.QuotaResponse;
import com.audisay.domain.user.dto.response.SettingsResponse;
import com.audisay.domain.user.dto.response.VerificationResponse;
import com.audisay.domain.user.service.UsageQuotaService;
import com.audisay.domain.user.service.UserService;
import com.audisay.domain.user.service.UserSettingsService;
import com.audisay.global.response.ApiResponse;
import com.audisay.global.security.AuthUser;
import com.audisay.global.security.RefreshTokenCookieProvider;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@Tag(name = "회원")
@RestController
@RequestMapping("/v1/users/me")
@RequiredArgsConstructor
public class UserController {
    private final UserService userService;
    private final UserSettingsService userSettingsService;
    private final UsageQuotaService usageQuotaService;
    private final RefreshTokenCookieProvider refreshTokenCookieProvider;

    @Operation(summary = "내 정보 조회")
    @GetMapping
    public ApiResponse<MeResponse> getMe(@AuthenticationPrincipal AuthUser authUser) {
        return ApiResponse.success("내 정보 조회 성공", userService.getMe(authUser.userId()));
    }

    @Operation(summary = "회원 탈퇴", description = "비밀번호를 확인하고 탈퇴한다. 모든 기기가 바로 로그아웃된다.")
    @DeleteMapping
    public ResponseEntity<ApiResponse<Void>> withdraw(@AuthenticationPrincipal AuthUser authUser,
                                                      @Valid @RequestBody WithdrawRequest request) {
        userService.withdraw(authUser, request);
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, refreshTokenCookieProvider.expire().toString())
                .body(ApiResponse.success("회원 탈퇴 성공"));
    }

    @Operation(summary = "비밀번호 변경", description = "지금 기기는 그대로 쓰고 다른 기기는 바로 로그아웃된다.")
    @PatchMapping("/password")
    public ApiResponse<Void> changePassword(@AuthenticationPrincipal AuthUser authUser,
                                            @Valid @RequestBody PasswordChangeRequest request) {
        userService.changePassword(authUser, request);
        return ApiResponse.success("비밀번호 변경 성공");
    }

    @Operation(summary = "이용 한도 조회", description = "역할별 하루 제한과 오늘(KST) 사용한 횟수")
    @GetMapping("/quota")
    public ApiResponse<QuotaResponse> getQuota(@AuthenticationPrincipal AuthUser authUser) {
        return ApiResponse.success("이용 횟수 조회 성공", usageQuotaService.getQuota(authUser.userId()));
    }

    @Operation(summary = "재생 설정 조회")
    @GetMapping("/settings")
    public ApiResponse<SettingsResponse> getSettings(@AuthenticationPrincipal AuthUser authUser) {
        return ApiResponse.success("재생 설정 조회 성공", userSettingsService.getSettings(authUser.userId()));
    }

    @Operation(summary = "재생 설정 변경", description = "보낸 필드만 바꾸고, 변경 후 전체 설정을 준다.")
    @PatchMapping("/settings")
    public ApiResponse<SettingsResponse> updateSettings(@AuthenticationPrincipal AuthUser authUser,
                                                        @Valid @RequestBody SettingsUpdateRequest request) {
        return ApiResponse.success("재생 설정 변경 성공", userSettingsService.updateSettings(authUser.userId(), request));
    }

    @Operation(summary = "시각장애인 인증 신청", description = "서류는 검사만 하고 저장하지 않는다. 새 역할이 담긴 AccessToken을 함께 준다.")
    @PostMapping(value = "/verification", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ApiResponse<VerificationResponse> verify(
            @AuthenticationPrincipal AuthUser authUser,
            @Parameter(description = "인증 서류 (PDF·JPG·PNG, 10MB 이하)") @RequestPart("document") MultipartFile document,
            @Parameter(description = "민감정보 처리 동의 (true만 허용)") @RequestParam(value = "sensitiveAgreed", required = false) Boolean sensitiveAgreed) {
        return ApiResponse.success("시각장애인 인증이 완료되었습니다.",
                userService.verifyVisuallyImpaired(authUser, document, sensitiveAgreed));
    }
}
