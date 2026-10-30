package com.audisay.domain.video.service;

import com.audisay.domain.user.entity.Role;
import com.audisay.domain.user.entity.User;
import com.audisay.domain.user.service.UserService;
import com.audisay.domain.video.dto.response.RetryResponse;
import com.audisay.domain.video.entity.GenerationResult;
import com.audisay.domain.video.entity.SourceType;
import com.audisay.domain.video.entity.Video;
import com.audisay.domain.video.repository.GenerationRequestRepository;
import com.audisay.domain.video.repository.VideoRepository;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import com.audisay.global.security.AuthUser;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 해설 생성에 실패한 영상의 해설을 다시 요청한다. 이 영상에 요청 기록이 있거나 업로드한 회원만 쓸 수 있다.
 */
@Service
@RequiredArgsConstructor
public class VideoRetryService {
    private final VideoService videoService;
    private final VideoRepository videoRepository;
    private final UserService userService;
    private final GenerationRequestRepository generationRequestRepository;
    private final DescriptionStateReader descriptionStateReader;
    private final YoutubeVideoService youtubeVideoService;
    private final PreparePayloadFactory preparePayloadFactory;
    private final RetryLauncher retryLauncher;
    private final TransactionTemplate transactionTemplate;

    /**
     * 유튜브 사전 확인은 트랜잭션 밖에서 한다. 그 사이 다른 요청이 작업을 만들면 작업 생성에서 JOB_002로 막힌다.
     */
    public RetryResponse retry(AuthUser authUser, Long videoId) {
        Role role = userService.getActiveUser(authUser.userId()).getRole();
        Video video = transactionTemplate.execute(status -> checkRetryable(authUser, videoId));
        if (video.getSourceType() == SourceType.YOUTUBE) {
            youtubeVideoService.getRequestableVideo(video.getYoutubeVideoId(), role);
        }
        return transactionTemplate.execute(status -> launch(authUser.userId(), videoId));
    }

    private Video checkRetryable(AuthUser authUser, Long videoId) {
        Video video = videoService.getAccessibleVideo(authUser, videoId);
        if (!video.isUploadedBy(authUser.userId())
                && !generationRequestRepository.existsByUser_IdAndVideo_IdAndResultNot(
                        authUser.userId(), videoId, GenerationResult.REJECTED)) {
            throw new BusinessException(ErrorCode.FORBIDDEN);
        }
        DescriptionState state = descriptionStateReader.read(videoId);
        if (state.activeJobId() != null) {
            throw new BusinessException(ErrorCode.JOB_ALREADY_RUNNING);
        }
        if (state.status() != VideoDescriptionStatus.FAILED) {
            throw new BusinessException(ErrorCode.JOB_NOT_RETRYABLE);
        }
        return video;
    }

    private RetryResponse launch(Long userId, Long videoId) {
        Video video = videoRepository.findById(videoId)
                .orElseThrow(() -> new BusinessException(ErrorCode.VIDEO_NOT_FOUND));
        User user = userService.getActiveUser(userId);
        RetryLauncher.Retried retried = retryLauncher.launch(video, user, preparePayloadFactory.create(video));
        return new RetryResponse(videoId, retried.job().getId(), GenerationResult.NEW_JOB, false,
                retried.retryRemainingToday());
    }
}
