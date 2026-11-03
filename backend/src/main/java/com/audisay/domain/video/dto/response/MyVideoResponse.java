package com.audisay.domain.video.dto.response;

import com.audisay.domain.video.entity.Category;
import com.audisay.domain.video.entity.SourceType;
import com.audisay.domain.video.entity.Video;
import com.audisay.domain.video.service.DescriptionState;
import com.audisay.domain.video.service.VideoDescriptionStatus;

import java.time.Instant;

/**
 * @param available 영상을 더 볼 수 없으면(UNAVAILABLE) false
 * @param jobId     진행 중인 작업. 없으면 null
 */
public record MyVideoResponse(
        Long videoId,
        SourceType sourceType,
        String title,
        String thumbnailUrl,
        Integer durationSec,
        Category category,
        boolean available,
        VideoDescriptionStatus descriptionStatus,
        Long jobId,
        Instant requestedAt
) {
    public static MyVideoResponse of(Video video, String thumbnailUrl, DescriptionState state, Instant requestedAt) {
        return new MyVideoResponse(
                video.getId(),
                video.getSourceType(),
                video.getTitle(),
                thumbnailUrl,
                video.getDurationSec(),
                video.getCategory(),
                video.isAvailable(),
                state.status(),
                state.activeJobId(),
                requestedAt
        );
    }
}
