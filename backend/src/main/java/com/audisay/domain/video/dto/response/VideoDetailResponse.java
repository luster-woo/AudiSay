package com.audisay.domain.video.dto.response;

import com.audisay.domain.video.entity.Category;
import com.audisay.domain.video.entity.SourceType;
import com.audisay.domain.video.entity.Video;
import com.audisay.domain.video.entity.VideoStatus;
import com.audisay.domain.video.entity.Visibility;
import com.audisay.domain.video.service.DescriptionState;

/**
 * @param descriptionId 지금 공개 중인 해설. 있으면 FE는 요약·해설 조회를 부른다
 * @param activeJobId   진행 중인 작업. 있으면 FE는 작업 SSE를 구독한다
 */
public record VideoDetailResponse(
        Long videoId,
        SourceType sourceType,
        String youtubeVideoId,
        String title,
        String channelTitle,
        String thumbnailUrl,
        Integer durationSec,
        Category category,
        Visibility visibility,
        VideoStatus status,
        boolean isOwner,
        boolean isFavorite,
        Long descriptionId,
        Long activeJobId
) {
    public static VideoDetailResponse of(Video video, boolean isOwner, boolean isFavorite, DescriptionState state) {
        return new VideoDetailResponse(
                video.getId(),
                video.getSourceType(),
                video.getYoutubeVideoId(),
                video.getTitle(),
                video.getChannelTitle(),
                video.getThumbnailUrl(),
                video.getDurationSec(),
                video.getCategory(),
                video.getVisibility(),
                video.getStatus(),
                isOwner,
                isFavorite,
                state.descriptionId(),
                state.activeJobId()
        );
    }
}
