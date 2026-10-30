package com.audisay.domain.admin.controller;

import com.audisay.domain.admin.dto.response.RegenerateResponse;
import com.audisay.domain.admin.service.AdminVideoService;
import com.audisay.global.response.ApiResponse;
import com.audisay.global.security.AuthUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "관리자")
@RestController
@RequestMapping("/v1/admin/videos")
@RequiredArgsConstructor
public class AdminVideoController {
    private final AdminVideoService adminVideoService;

    @Operation(summary = "해설 다시 만들기",
            description = "영상 해설 전체를 AI로 다시 만든다. 완성되기 전까지 기존 해설을 재생하고, 완성되면 기존 해설은 ARCHIVED")
    @PostMapping("/{videoId}/regenerate")
    public ResponseEntity<ApiResponse<RegenerateResponse>> regenerate(@AuthenticationPrincipal AuthUser authUser,
                                                                      @PathVariable("videoId") Long videoId) {
        return ResponseEntity.status(HttpStatus.ACCEPTED)
                .body(ApiResponse.success(HttpStatus.ACCEPTED, "해설 다시 만들기를 시작했습니다.",
                        adminVideoService.regenerate(authUser.userId(), videoId)));
    }
}
