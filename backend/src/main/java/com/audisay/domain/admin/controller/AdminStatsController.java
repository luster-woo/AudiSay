package com.audisay.domain.admin.controller;

import com.audisay.domain.admin.dto.response.AiUsageStatsResponse;
import com.audisay.domain.admin.service.AdminStatsService;
import com.audisay.global.response.ApiResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;

@Tag(name = "관리자")
@RestController
@RequestMapping("/v1/admin/stats")
@RequiredArgsConstructor
public class AdminStatsController {
    private final AdminStatsService adminStatsService;

    @Operation(summary = "AI 사용량 통계",
            description = "기간(KST, 양끝 포함, 최대 92일)의 AI 호출 수·토큰·추정 크레딧을 합계·용도별·모델별·일별로 주고, "
                    + "유튜브 해설 재사용으로 아낀 크레딧을 계산한다")
    @GetMapping("/ai-usage")
    public ApiResponse<AiUsageStatsResponse> getAiUsage(
            @Parameter(description = "시작일 YYYY-MM-DD", example = "2026-10-21")
            @RequestParam("from") @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @Parameter(description = "종료일 YYYY-MM-DD", example = "2026-11-03")
            @RequestParam("to") @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return ApiResponse.success("AI 사용량 통계 조회 성공", adminStatsService.getAiUsage(from, to));
    }
}
