package com.audisay.domain.video.dto.response;

import com.audisay.domain.video.entity.Video;
import com.audisay.domain.video.entity.Visibility;

public record VisibilityResponse(Long videoId, Visibility visibility) {
    public static VisibilityResponse from(Video video) {
        return new VisibilityResponse(video.getId(), video.getVisibility());
    }
}
