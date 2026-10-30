package com.audisay.domain.admin.controller;

import com.audisay.domain.admin.dto.request.LineUpdateRequest;
import com.audisay.domain.admin.dto.response.LineAudioResponse;
import com.audisay.domain.admin.dto.response.LineUpdateResponse;
import com.audisay.domain.admin.service.AdminDescriptionService;
import com.audisay.global.response.ApiResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "관리자")
@RestController
@RequestMapping("/v1/admin/lines")
@RequiredArgsConstructor
public class AdminLineController {
    private final AdminDescriptionService adminDescriptionService;

    @Operation(summary = "해설 문장 수정", description = "문장(1~500자)과 중요도를 고치고 음성을 비운 뒤 다시 만든다. 다음 재생부터 반영")
    @PatchMapping("/{lineId}")
    public ApiResponse<LineUpdateResponse> editLine(@PathVariable("lineId") Long lineId,
                                                    @Valid @RequestBody LineUpdateRequest request) {
        return ApiResponse.success("해설 문장을 수정했습니다. 음성을 다시 만드는 중입니다.",
                adminDescriptionService.editLine(lineId, request));
    }

    @Operation(summary = "해설 음성 다시 생성", description = "문장은 그대로 두고 음성을 비운 뒤 다시 만든다. 결과는 검수용 해설 조회로 확인")
    @PostMapping("/{lineId}/audio")
    public ResponseEntity<ApiResponse<LineAudioResponse>> regenerateAudio(@PathVariable("lineId") Long lineId) {
        return ResponseEntity.status(HttpStatus.ACCEPTED)
                .body(ApiResponse.success(HttpStatus.ACCEPTED, "음성을 다시 만드는 중입니다.",
                        adminDescriptionService.regenerateAudio(lineId)));
    }
}
