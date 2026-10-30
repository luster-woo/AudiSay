package com.audisay.domain.report.controller;

import com.audisay.domain.report.dto.request.ReportCreateRequest;
import com.audisay.domain.report.dto.response.ReportCreateResponse;
import com.audisay.domain.report.service.ReportService;
import com.audisay.global.response.ApiResponse;
import com.audisay.global.security.AuthUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "신고")
@RestController
@RequestMapping("/v1/lines")
@RequiredArgsConstructor
public class ReportController {
    private final ReportService reportService;

    @Operation(summary = "해설 신고", description = "같은 문장은 한 번만 신고할 수 있다. 신고 당시 문장을 함께 남긴다")
    @PostMapping("/{lineId}/reports")
    public ResponseEntity<ApiResponse<ReportCreateResponse>> report(@AuthenticationPrincipal AuthUser authUser,
                                                                    @PathVariable("lineId") Long lineId,
                                                                    @Valid @RequestBody ReportCreateRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.success(HttpStatus.CREATED, "신고가 접수되었습니다.",
                        reportService.report(authUser, lineId, request)));
    }
}
