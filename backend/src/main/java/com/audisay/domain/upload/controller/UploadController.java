package com.audisay.domain.upload.controller;

import com.audisay.domain.upload.dto.request.PartUrlRequest;
import com.audisay.domain.upload.dto.request.UploadCompleteRequest;
import com.audisay.domain.upload.dto.request.UploadStartRequest;
import com.audisay.domain.upload.dto.response.PartUrlResponse;
import com.audisay.domain.upload.dto.response.UploadCompleteResponse;
import com.audisay.domain.upload.dto.response.UploadStartResponse;
import com.audisay.domain.upload.service.UploadService;
import com.audisay.global.response.ApiResponse;
import com.audisay.global.security.AuthUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "업로드")
@RestController
@RequestMapping("/v1/uploads")
@RequiredArgsConstructor
public class UploadController {
    private final UploadService uploadService;

    @Operation(summary = "업로드 시작", description = "형식·용량·길이·횟수·저작권 동의를 검사하고 S3 멀티파트 업로드를 시작한다. 횟수 차감은 완료 때")
    @PostMapping
    public ResponseEntity<ApiResponse<UploadStartResponse>> start(@AuthenticationPrincipal AuthUser authUser,
                                                                  @Valid @RequestBody UploadStartRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.success(HttpStatus.CREATED, "업로드를 시작합니다.",
                        uploadService.start(authUser.userId(), request)));
    }

    @Operation(summary = "조각 업로드 주소 발급", description = "조각마다 S3 presigned PUT 주소(30분 유효). 한 번에 20개까지, 올린 회원만")
    @PostMapping("/{videoId}/parts")
    public ApiResponse<PartUrlResponse> issuePartUrls(@AuthenticationPrincipal AuthUser authUser,
                                                      @PathVariable("videoId") Long videoId,
                                                      @Valid @RequestBody PartUrlRequest request) {
        return ApiResponse.success("조각 업로드 주소 발급 성공",
                uploadService.issuePartUrls(authUser.userId(), videoId, request));
    }

    @Operation(summary = "업로드 완료", description = "S3 멀티파트 업로드를 마치고 해설 생성 작업을 만든다. 업로드 횟수는 여기서 차감")
    @PostMapping("/{videoId}/complete")
    public ApiResponse<UploadCompleteResponse> complete(@AuthenticationPrincipal AuthUser authUser,
                                                        @PathVariable("videoId") Long videoId,
                                                        @Valid @RequestBody UploadCompleteRequest request) {
        return ApiResponse.success("업로드가 완료되어 해설 생성을 시작했습니다.",
                uploadService.complete(authUser.userId(), videoId, request));
    }

    @Operation(summary = "업로드 중단", description = "올라간 조각을 지우고 영상을 지운다. 횟수 차감 없음")
    @DeleteMapping("/{videoId}")
    public ApiResponse<Void> abort(@AuthenticationPrincipal AuthUser authUser,
                                   @PathVariable("videoId") Long videoId) {
        uploadService.abort(authUser.userId(), videoId);
        return ApiResponse.success("업로드를 취소했습니다.");
    }
}
