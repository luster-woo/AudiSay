package com.audisay.domain.video.entity;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

import java.util.Arrays;
import java.util.Optional;

/** 올릴 수 있는 영상 형식. video_uploads.content_type에는 contentType 문자열을 그대로 저장한다 */
@Getter
@RequiredArgsConstructor
public enum VideoFormat {
    MP4("video/mp4", "mp4"),
    MOV("video/quicktime", "mov"),
    WEBM("video/webm", "webm");

    private final String contentType;
    private final String extension;

    public static Optional<VideoFormat> fromContentType(String contentType) {
        return Arrays.stream(values())
                .filter(format -> format.contentType.equalsIgnoreCase(contentType))
                .findFirst();
    }
}
