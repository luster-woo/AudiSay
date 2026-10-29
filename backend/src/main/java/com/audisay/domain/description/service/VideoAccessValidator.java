package com.audisay.domain.description.service;

import com.audisay.domain.video.entity.Video;
import com.audisay.domain.video.repository.VideoRepository;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import com.audisay.global.security.AuthUser;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 비공개 영상은 올린 회원과 관리자만 볼 수 있다.
 */
@Component
@RequiredArgsConstructor
public class VideoAccessValidator {
    private final VideoRepository videoRepository;

    public Video getAccessibleVideo(AuthUser authUser, Long videoId) {
        Video video = videoRepository.findById(videoId)
                .orElseThrow(() -> new BusinessException(ErrorCode.VIDEO_NOT_FOUND));
        if (!video.isViewableBy(authUser.userId(), authUser.role())) {
            throw new BusinessException(ErrorCode.VIDEO_PRIVATE);
        }
        return video;
    }
}
