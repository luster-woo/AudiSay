package com.audisay.domain.video.service;

import com.audisay.domain.favorite.repository.FavoriteRepository;
import com.audisay.domain.video.dto.request.VisibilityUpdateRequest;
import com.audisay.domain.video.dto.response.MyVideoResponse;
import com.audisay.domain.video.dto.response.PlaybackResponse;
import com.audisay.domain.video.dto.response.VideoDetailResponse;
import com.audisay.domain.video.dto.response.VideoSummaryResponse;
import com.audisay.domain.video.dto.response.VisibilityResponse;
import com.audisay.domain.video.entity.Category;
import com.audisay.domain.video.entity.SourceType;
import com.audisay.domain.video.entity.Video;
import com.audisay.domain.video.entity.VideoUpload;
import com.audisay.domain.video.repository.GenerationRequestRepository;
import com.audisay.domain.video.repository.MyVideoRow;
import com.audisay.domain.video.repository.VideoRepository;
import com.audisay.domain.video.repository.VideoUploadRepository;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import com.audisay.global.external.s3.S3Properties;
import com.audisay.global.external.s3.S3StorageClient;
import com.audisay.global.external.s3.S3StorageClient.PresignedUrl;
import com.audisay.global.response.PageResponse;
import com.audisay.global.security.AuthUser;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class VideoService {
    private final VideoRepository videoRepository;
    private final GenerationRequestRepository generationRequestRepository;
    private final FavoriteRepository favoriteRepository;
    private final DescriptionStateReader descriptionStateReader;
    private final VideoUploadRepository videoUploadRepository;
    private final S3StorageClient s3StorageClient;
    private final S3Properties s3Properties;

    /**
     * 공개 해설이 있는 공개 영상 목록. category가 null이면 전체 카테고리.
     */
    @Transactional(readOnly = true)
    public PageResponse<VideoSummaryResponse> getPublishedVideos(Long userId, Category category, Pageable pageable) {
        Page<Video> videos = videoRepository.findPublished(category, pageable);
        List<Long> videoIds = videos.map(Video::getId).getContent();
        Set<Long> favoriteIds = videoIds.isEmpty() ? Set.of() : favoriteRepository.findVideoIds(userId, videoIds);
        return PageResponse.from(videos.map(video -> VideoSummaryResponse.of(video, favoriteIds.contains(video.getId()))));
    }

    @Transactional(readOnly = true)
    public VideoDetailResponse getVideo(AuthUser authUser, Long videoId) {
        Video video = getAccessibleVideo(authUser, videoId);
        return VideoDetailResponse.of(
                video,
                video.isUploadedBy(authUser.userId()),
                favoriteRepository.existsByUserIdAndVideoId(authUser.userId(), videoId),
                descriptionStateReader.read(videoId)
        );
    }

    /**
     * 유튜브 영상은 IFrame 플레이어용 영상 ID만 준다.
     * 업로드 영상은 재생용 파일의 presigned GET 주소를 주고, 변환이 끝나지 않았으면 UPLOAD_006.
     */
    @Transactional(readOnly = true)
    public PlaybackResponse getPlayback(AuthUser authUser, Long videoId) {
        Video video = getAccessibleVideo(authUser, videoId);
        if (video.getSourceType() == SourceType.YOUTUBE) {
            return PlaybackResponse.youtube(video.getYoutubeVideoId());
        }
        VideoUpload upload = videoUploadRepository.findById(videoId)
                .filter(VideoUpload::isPlayable)
                .orElseThrow(() -> new BusinessException(ErrorCode.PLAYBACK_NOT_READY));
        PresignedUrl url = s3StorageClient.presignGet(upload.getPlaybackKey(), s3Properties.playbackUrlExpiration());
        return PlaybackResponse.upload(url.url(), upload.getPlaybackFormat(), url.expiresAt());
    }

    /**
     * 업로드 영상만, 올린 회원만 바꿀 수 있다. 유튜브 영상은 항상 공개다.
     */
    @Transactional
    public VisibilityResponse changeVisibility(Long userId, Long videoId, VisibilityUpdateRequest request) {
        Video video = videoRepository.findById(videoId)
                .orElseThrow(() -> new BusinessException(ErrorCode.VIDEO_NOT_FOUND));
        if (video.getSourceType() == SourceType.YOUTUBE) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "유튜브 영상은 공개 범위를 바꿀 수 없습니다.");
        }
        if (!video.isUploadedBy(userId)) {
            throw new BusinessException(ErrorCode.FORBIDDEN, "영상을 올린 회원만 바꿀 수 있습니다.");
        }
        video.changeVisibility(request.visibility());
        return VisibilityResponse.from(video);
    }

    /**
     * 내가 해설을 요청하거나 올린 영상. 마지막 요청 시각 최신순이다.
     */
    @Transactional(readOnly = true)
    public PageResponse<MyVideoResponse> getMyVideos(Long userId, Pageable pageable) {
        Page<MyVideoRow> rows = generationRequestRepository.findMyVideos(userId, pageable);
        List<Long> videoIds = rows.map(MyVideoRow::videoId).getContent();
        Map<Long, Video> videos = videoRepository.findAllById(videoIds).stream()
                .collect(Collectors.toMap(Video::getId, Function.identity()));
        Map<Long, DescriptionState> states = descriptionStateReader.readAll(videoIds);
        return PageResponse.from(rows.map(row -> MyVideoResponse.of(
                videos.get(row.videoId()), states.get(row.videoId()), row.lastRequestedAt())));
    }

    /**
     * 비공개 영상은 올린 회원과 관리자만 볼 수 있다.
     */
    @Transactional(readOnly = true)
    public Video getAccessibleVideo(AuthUser authUser, Long videoId) {
        Video video = videoRepository.findById(videoId)
                .orElseThrow(() -> new BusinessException(ErrorCode.VIDEO_NOT_FOUND));
        if (!video.isViewableBy(authUser.userId(), authUser.role())) {
            throw new BusinessException(ErrorCode.VIDEO_PRIVATE);
        }
        return video;
    }
}
