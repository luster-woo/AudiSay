package com.audisay.domain.video.controller;

import com.audisay.domain.video.dto.request.VisibilityUpdateRequest;
import com.audisay.domain.video.dto.request.YoutubeCheckRequest;
import com.audisay.domain.video.dto.request.YoutubeSearchRequest;
import com.audisay.domain.video.dto.response.PlaybackResponse;
import com.audisay.domain.video.dto.response.VideoDetailResponse;
import com.audisay.domain.video.dto.response.VideoSummaryResponse;
import com.audisay.domain.video.dto.response.VisibilityResponse;
import com.audisay.domain.video.dto.response.YoutubeCheckResponse;
import com.audisay.domain.video.dto.response.YoutubeRequestResponse;
import com.audisay.domain.video.dto.response.YoutubeSearchResponse;
import com.audisay.domain.video.entity.Category;
import com.audisay.domain.video.service.VideoService;
import com.audisay.domain.video.service.YoutubeRequestService;
import com.audisay.domain.video.service.YoutubeVideoService;
import com.audisay.global.request.PageParams;
import com.audisay.global.response.ApiResponse;
import com.audisay.global.response.PageResponse;
import com.audisay.global.security.AuthUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "영상")
@RestController
@RequestMapping("/v1/videos")
@RequiredArgsConstructor
public class VideoController {
    private final VideoService videoService;
    private final YoutubeVideoService youtubeVideoService;
    private final YoutubeRequestService youtubeRequestService;

    @Operation(summary = "해설 영상 목록", description = "공개 해설이 있는 공개 영상. 해설을 만든 시각 최신순")
    @GetMapping
    public ApiResponse<PageResponse<VideoSummaryResponse>> getVideos(
            @AuthenticationPrincipal AuthUser authUser,
            @Parameter(description = "비우면 전체 카테고리") @RequestParam(value = "category", required = false) Category category,
            @Valid @ModelAttribute PageParams pageParams) {
        return ApiResponse.success("해설 영상 목록 조회 성공",
                videoService.getPublishedVideos(authUser.userId(), category, pageParams.toPageable()));
    }

    @Operation(summary = "유튜브 사전 확인", description = "해설을 만들 수 있는지 확인만 한다. 조건이 안 맞아도 200으로 이유를 준다. 횟수 차감 없음")
    @PostMapping("/youtube/check")
    public ApiResponse<YoutubeCheckResponse> checkYoutube(@AuthenticationPrincipal AuthUser authUser,
                                                          @Valid @RequestBody YoutubeCheckRequest request) {
        return ApiResponse.success("유튜브 영상 확인 성공", youtubeVideoService.check(authUser.userId(), request.url()));
    }

    @Operation(summary = "유튜브 해설 요청",
            description = "완성된 해설은 재사용(REUSED), 만드는 중이면 합류(JOINED_JOB), 없으면 새 작업(NEW_JOB, 하루 횟수 차감). "
                    + "실패한 영상은 차감 없이 다시 만든다(영상당 하루 3번)")
    @PostMapping("/youtube")
    public ApiResponse<YoutubeRequestResponse> requestYoutube(@AuthenticationPrincipal AuthUser authUser,
                                                              @Valid @RequestBody YoutubeCheckRequest request) {
        YoutubeRequestResponse response = youtubeRequestService.request(authUser.userId(), request.url());
        String message = switch (response.result()) {
            case REUSED -> "이미 해설이 있습니다.";
            case JOINED_JOB -> "해설을 만드는 중입니다.";
            case NEW_JOB, REJECTED -> "해설 생성을 시작했습니다.";
        };
        return ApiResponse.success(message, response);
    }

    @Operation(summary = "유튜브 검색", description = "해설이 있는 영상을 앞에 둔다. 10개씩, nextPageToken으로 다음 결과")
    @GetMapping("/youtube/search")
    public ApiResponse<YoutubeSearchResponse> searchYoutube(@Valid @ModelAttribute YoutubeSearchRequest request) {
        return ApiResponse.success("유튜브 검색 성공", youtubeVideoService.search(request));
    }

    @Operation(summary = "영상 상세 조회", description = "영상 정보와 공개 해설 ID, 진행 중 작업 ID, 즐겨찾기 여부")
    @GetMapping("/{videoId}")
    public ApiResponse<VideoDetailResponse> getVideo(@AuthenticationPrincipal AuthUser authUser,
                                                     @PathVariable("videoId") Long videoId) {
        return ApiResponse.success("영상 조회 성공", videoService.getVideo(authUser, videoId));
    }

    @Operation(summary = "재생 주소 조회", description = "유튜브 영상은 IFrame용 영상 ID를 준다")
    @GetMapping("/{videoId}/playback")
    public ApiResponse<PlaybackResponse> getPlayback(@AuthenticationPrincipal AuthUser authUser,
                                                     @PathVariable("videoId") Long videoId) {
        return ApiResponse.success("재생 주소 조회 성공", videoService.getPlayback(authUser, videoId));
    }

    @Operation(summary = "공개 범위 변경", description = "업로드 영상만, 올린 회원만 바꿀 수 있다")
    @PatchMapping("/{videoId}/visibility")
    public ApiResponse<VisibilityResponse> changeVisibility(@AuthenticationPrincipal AuthUser authUser,
                                                            @PathVariable("videoId") Long videoId,
                                                            @Valid @RequestBody VisibilityUpdateRequest request) {
        return ApiResponse.success("공개 범위 변경 성공",
                videoService.changeVisibility(authUser.userId(), videoId, request));
    }
}
