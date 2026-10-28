package com.audisay.domain.description.controller;

import com.audisay.domain.description.dto.response.ChapterResponse;
import com.audisay.domain.description.dto.response.DescriptionResponse;
import com.audisay.domain.description.dto.response.SummaryResponse;
import com.audisay.domain.description.service.DescriptionService;
import com.audisay.global.response.ApiResponse;
import com.audisay.global.security.AuthUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "해설 재생")
@RestController
@RequestMapping("/v1/videos")
@RequiredArgsConstructor
public class DescriptionController {
    private final DescriptionService descriptionService;

    @Operation(summary = "해설 조회", description = "재생용 해설 전체. 상세도 1~3 문장, 장면, 대사, 화면 글자")
    @GetMapping("/{videoId}/description")
    public ApiResponse<DescriptionResponse> getDescription(@AuthenticationPrincipal AuthUser authUser,
                                                           @PathVariable("videoId") Long videoId) {
        return ApiResponse.success("해설 조회 성공", descriptionService.getDescription(authUser, videoId));
    }

    @Operation(summary = "30초 요약 조회", description = "요약 문장과 음성. 사용자가 정한다")
    @GetMapping("/{videoId}/summary")
    public ApiResponse<SummaryResponse> getSummary(@AuthenticationPrincipal AuthUser authUser,
                                                   @PathVariable("videoId") Long videoId) {
        return ApiResponse.success("요약 조회 성공", descriptionService.getSummary(authUser, videoId));
    }

    @Operation(summary = "장면 목차 조회", description = "큰 구간 목록. chapterIndex 순서")
    @GetMapping("/{videoId}/chapters")
    public ApiResponse<ChapterResponse> getChapters(@AuthenticationPrincipal AuthUser authUser,
                                                    @PathVariable("videoId") Long videoId) {
        return ApiResponse.success("장면 목차 조회 성공", descriptionService.getChapters(authUser, videoId));
    }
}
