package com.audisay.domain.favorite.dto.response;

import com.audisay.domain.video.entity.Category;
import com.audisay.domain.video.entity.SourceType;
import com.audisay.domain.video.entity.Video;

import java.time.Instant;

/**
 * @param hasDescription 공개 해설이 있는지
 * @param available      볼 수 없으면(UNAVAILABLE이거나 비공개로 바뀐 남의 업로드) false
 * @param favoritedAt    즐겨찾기에 넣은 시각
 */
public record FavoriteVideoResponse(
        Long videoId,
        SourceType sourceType,
        String title,
        String thumbnailUrl,
        Integer durationSec,
        Category category,
        boolean hasDescription,
        boolean available,
        Instant favoritedAt
) {
    public static FavoriteVideoResponse of(Video video, String thumbnailUrl, boolean hasDescription, boolean available,
                                           Instant favoritedAt) {
        return new FavoriteVideoResponse(
                video.getId(),
                video.getSourceType(),
                video.getTitle(),
                thumbnailUrl,
                video.getDurationSec(),
                video.getCategory(),
                hasDescription,
                available,
                favoritedAt
        );
    }
}
