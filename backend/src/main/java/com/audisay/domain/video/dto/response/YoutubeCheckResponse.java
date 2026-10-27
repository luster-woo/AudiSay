package com.audisay.domain.video.dto.response;

import com.audisay.domain.video.service.VideoDescriptionStatus;

/**
 * @param videoId   이미 등록된 영상이면 그 ID
 * @param willCount 해설을 요청하면 하루 이용 횟수가 차감되는지 (해설이 없어 새로 만들 때만 true)
 */
public record YoutubeCheckResponse(
        String youtubeVideoId,
        String title,
        String channelTitle,
        String thumbnailUrl,
        Integer durationSec,
        boolean available,
        YoutubeRejectReason rejectReason,
        Long videoId,
        VideoDescriptionStatus descriptionStatus,
        boolean willCount
) {
}
