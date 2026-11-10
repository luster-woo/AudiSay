package com.audisay.domain.video.service;

import com.audisay.domain.job.entity.Job;
import com.audisay.domain.job.entity.JobType;
import com.audisay.domain.job.service.JobLauncher;
import com.audisay.domain.user.entity.Role;
import com.audisay.domain.user.entity.User;
import com.audisay.domain.user.service.UserService;
import com.audisay.domain.video.dto.response.YoutubeRequestResponse;
import com.audisay.domain.video.entity.GenerationRequest;
import com.audisay.domain.video.entity.GenerationResult;
import com.audisay.domain.video.entity.SourceType;
import com.audisay.domain.video.entity.Video;
import com.audisay.domain.video.repository.GenerationRequestRepository;
import com.audisay.domain.video.repository.VideoRepository;
import com.audisay.global.config.UsageLimitProperties;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import com.audisay.global.external.youtube.YoutubeVideo;
import com.audisay.global.lock.RedisLock;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.LocalDate;
import java.util.EnumSet;
import java.util.Set;

/**
 * 유튜브 해설 요청. 완성된 해설은 재사용(REUSED), 만드는 중이면 합류(JOINED_JOB), 없으면 새 작업(NEW_JOB)이다.
 * 실패한 영상은 해설 다시 요청과 같은 규칙(차감 없음, 영상당 하루 3번)으로 새 작업을 만든다.
 */
@Service
@RequiredArgsConstructor
public class YoutubeRequestService {
    private static final String LOCK_PREFIX = "youtube:";
    private static final Duration LOCK_TTL = Duration.ofSeconds(10);
    private static final Duration LOCK_WAIT = Duration.ofSeconds(3);
    /** 영상 행이 이미 있으면 REJECTED로 남기는 거절 */
    private static final Set<ErrorCode> REJECTIONS = EnumSet.of(
            ErrorCode.YOUTUBE_VIDEO_UNAVAILABLE, ErrorCode.YOUTUBE_EMBED_BLOCKED, ErrorCode.VIDEO_TOO_LONG,
            ErrorCode.VIDEO_RESTRICTED, ErrorCode.DAILY_LIMIT_EXCEEDED, ErrorCode.RETRY_LIMIT_EXCEEDED);

    private final YoutubeVideoService youtubeVideoService;
    private final UserService userService;
    private final VideoRepository videoRepository;
    private final DescriptionStateReader descriptionStateReader;
    private final GenerationRequestRepository generationRequestRepository;
    private final GenerationRequestService generationRequestService;
    private final JobLauncher jobLauncher;
    private final RetryLauncher retryLauncher;
    private final RedisLock redisLock;
    private final TransactionTemplate transactionTemplate;
    private final UsageLimitProperties usageLimitProperties;

    /**
     * 트랜잭션을 직접 연다. 유튜브 API는 트랜잭션 밖에서 부르고, 락은 커밋이 끝난 뒤 풀어야 다음 요청이 새 작업을 본다.
     * 거절은 그 트랜잭션이 롤백된 뒤 따로 기록한다.
     */
    public YoutubeRequestResponse request(Long userId, String url) {
        String youtubeVideoId = YoutubeUrlParser.extractVideoId(url);
        Role role = userService.getActiveUser(userId).getRole();
        try {
            YoutubeVideo youtubeVideo = youtubeVideoService.getRequestableVideo(youtubeVideoId, role);
            // 같은 영상의 동시 요청이 영상·작업을 하나만 만들게 한다. 그래도 겹치면 DB 유니크 제약이 막는다
            try (RedisLock.Handle lock = redisLock.tryLock(LOCK_PREFIX + youtubeVideoId, LOCK_TTL, LOCK_WAIT)
                    .orElseThrow(() -> new BusinessException(ErrorCode.JOB_ALREADY_RUNNING))) {
                return transactionTemplate.execute(status -> handle(userId, youtubeVideo));
            }
        } catch (BusinessException e) {
            if (REJECTIONS.contains(e.getErrorCode())) {
                recordRejected(userId, youtubeVideoId, e.getErrorCode());
            }
            throw e;
        }
    }

    private YoutubeRequestResponse handle(Long userId, YoutubeVideo youtubeVideo) {
        User user = userService.getActiveUser(userId);
        LocalDate today = GenerationRequestService.todayKst();
        Video video = videoRepository.findByYoutubeVideoId(youtubeVideo.id()).orElse(null);
        if (video != null) {
            // 방금 유튜브에서 볼 수 있다고 확인했다 (예전에 볼 수 없음으로 표시했으면 되돌린다)
            video.markAvailable();
        }
        DescriptionState state = video == null ? DescriptionState.NONE : descriptionStateReader.read(video.getId());
        return switch (state.status()) {
            case READY -> {
                generationRequestRepository.save(GenerationRequest.reused(user, video, today));
                yield response(video, GenerationResult.REUSED, null, state.descriptionId(), false, user, today);
            }
            case GENERATING -> {
                generationRequestRepository.save(GenerationRequest.joinedJob(user, video, state.activeJobId(), today));
                yield response(video, GenerationResult.JOINED_JOB, state.activeJobId(), null, false, user, today);
            }
            case FAILED -> {
                // 다시 할 수 없는 실패(TRANSCODE_FAILED 등)면 다시 만들지 않는다. 영상은 방금 다시 확인했다(getRequestableVideo)
                if (descriptionStateReader.latestFailureNotRetryable(video.getId(), true)) {
                    throw new BusinessException(ErrorCode.JOB_NOT_RETRYABLE);
                }
                RetryLauncher.Retried retried = retryLauncher.launch(video, user, PreparePayloadFactory.youtube(video));
                yield response(video, GenerationResult.NEW_JOB, retried.job().getId(), null, false, user, today);
            }
            case NONE -> newJob(user, video, youtubeVideo, today);
        };
    }

    /** 처음 요청이면 영상을 등록한다. 남은 횟수는 등록 전에 확인해 거절된 영상 행이 남지 않게 한다 */
    private YoutubeRequestResponse newJob(User user, Video registered, YoutubeVideo youtubeVideo, LocalDate today) {
        Integer remaining = remaining(user, today);
        if (remaining != null && remaining == 0) {
            throw new BusinessException(ErrorCode.DAILY_LIMIT_EXCEEDED, "오늘 유튜브 해설 횟수를 다 썼어요.");
        }
        Video video = registered != null ? registered : register(youtubeVideo);
        Job job = jobLauncher.launch(video, user, JobType.GENERATE, PreparePayloadFactory.youtube(video));
        generationRequestRepository.save(GenerationRequest.newJob(user, video, job.getId(), today));
        return response(video, GenerationResult.NEW_JOB, job.getId(), null, true, user, today);
    }

    private Video register(YoutubeVideo youtubeVideo) {
        try {
            return videoRepository.saveAndFlush(Video.createYoutube(youtubeVideo.id(), youtubeVideo.title(),
                    youtubeVideo.channelTitle(), youtubeVideo.thumbnailUrl(), youtubeVideo.durationSec()));
        } catch (DataIntegrityViolationException e) {
            // 락이 만료된 사이 다른 요청이 먼저 등록한 경우(uq_videos_youtube_video_id)
            throw new BusinessException(ErrorCode.JOB_ALREADY_RUNNING);
        }
    }

    private void recordRejected(Long userId, String youtubeVideoId, ErrorCode reason) {
        transactionTemplate.executeWithoutResult(status -> videoRepository.findByYoutubeVideoId(youtubeVideoId)
                .ifPresent(video -> {
                    // 지워졌거나 비공개로 바뀐 영상은 목록·즐겨찾기에 '볼 수 없음'으로 보이게 표시해 둔다
                    if (reason == ErrorCode.YOUTUBE_VIDEO_UNAVAILABLE) {
                        video.markUnavailable();
                    }
                    generationRequestRepository.save(GenerationRequest.rejected(
                            userService.getActiveUser(userId), video, GenerationRequestService.todayKst()));
                }));
    }

    private YoutubeRequestResponse response(Video video, GenerationResult result, Long jobId, Long descriptionId,
                                            boolean counted, User user, LocalDate today) {
        return new YoutubeRequestResponse(video.getId(), result, jobId, descriptionId, counted, remaining(user, today));
    }

    /** 관리자는 제한이 없어 null */
    private Integer remaining(User user, LocalDate today) {
        return usageLimitProperties.forRole(user.getRole())
                .map(limit -> {
                    long used = generationRequestService.countUsage(user.getId(), today).get(SourceType.YOUTUBE);
                    return (int) Math.max(0, limit.youtube().dailyCount() - used);
                })
                .orElse(null);
    }

}
