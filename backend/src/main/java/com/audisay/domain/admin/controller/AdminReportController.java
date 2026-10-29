package com.audisay.domain.admin.controller;

import com.audisay.domain.admin.dto.request.ReportHandleRequest;
import com.audisay.domain.admin.dto.response.AdminReportResponse;
import com.audisay.domain.admin.dto.response.ReportHandleResponse;
import com.audisay.domain.admin.service.AdminReportService;
import com.audisay.domain.report.entity.ReportReason;
import com.audisay.domain.report.entity.ReportStatus;
import com.audisay.global.request.PageParams;
import com.audisay.global.response.ApiResponse;
import com.audisay.global.response.PageResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "관리자")
@RestController
@RequestMapping("/v1/admin/reports")
@RequiredArgsConstructor
public class AdminReportController {
    private final AdminReportService adminReportService;

    @Operation(summary = "신고 목록 조회", description = "오래된 순. 신고 당시 문장과 지금 문장, 같은 문장 신고 수를 함께 준다")
    @GetMapping
    public ApiResponse<PageResponse<AdminReportResponse>> getReports(
            @Parameter(description = "비우면 PENDING") @RequestParam(value = "status", required = false) ReportStatus status,
            @Parameter(description = "비우면 전체 사유") @RequestParam(value = "reason", required = false) ReportReason reason,
            @Parameter(description = "특정 영상의 신고만") @RequestParam(value = "videoId", required = false) Long videoId,
            @Valid @ModelAttribute PageParams pageParams) {
        return ApiResponse.success("신고 목록 조회 성공",
                adminReportService.getReports(status, reason, videoId, pageParams.toPageable()));
    }

    @Operation(summary = "신고 처리", description = "처리 전 신고를 RESOLVED 또는 REJECTED로 바꾼다. 이미 처리한 신고는 409")
    @PatchMapping("/{reportId}")
    public ApiResponse<ReportHandleResponse> handleReport(@PathVariable("reportId") Long reportId,
                                                          @Valid @RequestBody ReportHandleRequest request) {
        return ApiResponse.success("신고 처리 성공", adminReportService.handle(reportId, request));
    }
}
