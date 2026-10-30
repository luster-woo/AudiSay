package com.audisay.domain.video.service;

import com.audisay.domain.job.entity.Job;
import com.audisay.domain.job.entity.JobType;
import com.audisay.domain.job.message.payload.PreparePayload;
import com.audisay.domain.job.service.JobLauncher;
import com.audisay.domain.user.entity.User;
import com.audisay.domain.video.entity.GenerationRequest;
import com.audisay.domain.video.entity.Video;
import com.audisay.domain.video.repository.GenerationRequestRepository;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;

/**
 * 해설 생성에 실패한 영상의 작업을 처음부터 다시 만든다. 유튜브 해설 요청(FAILED 영상)과 해설 다시 요청 API가 함께 쓴다.
 * 실패는 사용자 책임이 아니라 하루 이용 횟수를 차감하지 않는 대신, 같은 영상은 하루 3번까지만 다시 만든다.
 */
@Component
@RequiredArgsConstructor
public class RetryLauncher {
    static final int DAILY_RETRY_LIMIT = 3;

    private final JobLauncher jobLauncher;
    private final GenerationRequestRepository generationRequestRepository;

    /**
     * 호출한 쪽 트랜잭션 안에서 작업과 요청 기록(NEW_JOB, counted false)을 남긴다.
     * 오늘 다시 만든 횟수를 다 썼으면 LIMIT_002, 진행 중인 작업이 있으면 JOB_002.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public Retried launch(Video video, User user, PreparePayload payload) {
        LocalDate today = GenerationRequestService.todayKst();
        long used = generationRequestRepository.countRetries(video.getId(), today);
        if (used >= DAILY_RETRY_LIMIT) {
            throw new BusinessException(ErrorCode.RETRY_LIMIT_EXCEEDED);
        }
        Job job = jobLauncher.launch(video, user, JobType.GENERATE, payload);
        generationRequestRepository.save(GenerationRequest.retry(user, video, job.getId(), today));
        return new Retried(job, (int) (DAILY_RETRY_LIMIT - used - 1));
    }

    /**
     * @param retryRemainingToday 이 영상을 오늘 더 다시 만들 수 있는 횟수
     */
    public record Retried(Job job, int retryRemainingToday) {
    }
}
