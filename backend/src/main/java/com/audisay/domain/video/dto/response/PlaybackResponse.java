package com.audisay.domain.video.dto.response;

import com.audisay.domain.video.entity.PlaybackFormat;
import com.audisay.domain.video.entity.SourceType;

import java.time.Instant;

/**
 * 업로드 영상은 S3 presigned 주소(playbackUrl), 유튜브 영상은 IFrame용 youtubeVideoId만 채운다.
 */
public record PlaybackResponse(
        SourceType sourceType,
        String playbackUrl,
        String playbackFormat,
        Instant expiresAt,
        String youtubeVideoId
) {
    public static PlaybackResponse youtube(String youtubeVideoId) {
        return new PlaybackResponse(SourceType.YOUTUBE, null, null, null, youtubeVideoId);
    }

    public static PlaybackResponse upload(String playbackUrl, PlaybackFormat playbackFormat, Instant expiresAt) {
        return new PlaybackResponse(SourceType.UPLOAD, playbackUrl,
                playbackFormat == null ? null : playbackFormat.name(), expiresAt, null);
    }
}
