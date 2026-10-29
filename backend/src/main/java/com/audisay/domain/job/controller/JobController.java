package com.audisay.domain.job.controller;

import com.audisay.domain.job.dto.response.JobStatusResponse;
import com.audisay.domain.job.service.JobQueryService;
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

@Tag(name = "해설 생성 작업")
@RestController
@RequestMapping("/v1/jobs")
@RequiredArgsConstructor
public class JobController {
    private final JobQueryService jobQueryService;

    @Operation(summary = "작업 상태 조회", description = "재진입·SSE 끊김 복구용. 진행 중이면 최신 진행률, 끝났으면 결과")
    @GetMapping("/{jobId}")
    public ApiResponse<JobStatusResponse> getJob(@AuthenticationPrincipal AuthUser authUser,
                                                 @PathVariable("jobId") Long jobId) {
        return ApiResponse.success("작업 상태 조회 성공", jobQueryService.getJob(authUser, jobId));
    }
}
