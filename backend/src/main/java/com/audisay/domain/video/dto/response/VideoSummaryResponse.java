package com.audisay.domain.video.dto.response;

import com.audisay.domain.video.entity.Category;
import com.audisay.domain.video.entity.SourceType;
import com.audisay.domain.video.entity.Video;

public record VideoSummaryResponse(
        Long videoId,
        SourceType sourceType,
        String title,
        String channelTitle,
        String thumbnailUrl,
        Integer durationSec,
        Category category,
        boolean isFavorite
) {
    public static VideoSummaryResponse of(Video video, String thumbnailUrl, boolean isFavorite) {
        return new VideoSummaryResponse(
                video.getId(),
                video.getSourceType(),
                video.getTitle(),
                video.getChannelTitle(),
                thumbnailUrl,
                video.getDurationSec(),
                video.getCategory(),
                isFavorite
        );
    }
}
