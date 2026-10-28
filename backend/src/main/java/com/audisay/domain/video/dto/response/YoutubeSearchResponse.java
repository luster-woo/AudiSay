package com.audisay.domain.video.dto.response;

import java.util.List;

/**
 * @param nextPageToken 다음 결과가 없으면 null
 */
public record YoutubeSearchResponse(List<Item> items, String nextPageToken) {

    /**
     * @param videoId 이미 등록된 영상이면 그 ID
     */
    public record Item(
            String youtubeVideoId,
            String title,
            String channelTitle,
            String thumbnailUrl,
            Integer durationSec,
            boolean hasDescription,
            Long videoId
    ) {
    }
}
