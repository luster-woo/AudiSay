package com.audisay.domain.job.service;

import com.audisay.domain.description.service.DescriptionService;
import com.audisay.domain.job.dto.JobProgress;
import com.audisay.domain.job.dto.response.JobStatusResponse;
import com.audisay.domain.job.entity.Job;
import com.audisay.domain.job.entity.JobStatus;
import com.audisay.domain.job.repository.JobChunkRepository;
import com.audisay.domain.job.repository.JobRepository;
import com.audisay.domain.user.entity.Role;
import com.audisay.domain.video.service.GenerationRequestService;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import com.audisay.global.security.AuthUser;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class JobQueryService {
    private final JobRepository jobRepository;
    private final JobChunkRepository jobChunkRepository;
    private final JobProgressStore progressStore;
    private final GenerationRequestService generationRequestService;
    private final DescriptionService descriptionService;
    private final JobTimeEstimator timeEstimator;

    public JobStatusResponse getJob(AuthUser authUser, Long jobId) {
        return toResponse(getViewableJob(authUser, jobId));
    }

    /**
     * 끝난 작업의 최종 상태(작업 SSE가 끝 알림을 놓쳤을 때 대신 보낼 것). 권한은 구독할 때 이미 확인했다
     */
    public List<JobStatusResponse> findFinished(Collection<Long> jobIds) {
        return jobRepository.findAllById(jobIds).stream()
                .filter(Job::isFinished)
                .map(this::toResponse)
                .toList();
    }

    private JobStatusResponse toResponse(Job job) {
        Long jobId = job.getId();
        if (!job.isFinished()) {
            JobProgress progress = storedProgress(job);
            return JobStatusResponse.inProgress(job, progress, timeEstimator.estimate(job, progress.progress()));
        }
        if (job.getStatus() == JobStatus.FAILED) {
            return JobStatusResponse.finished(job, null, null);
        }
        Long descriptionId = descriptionService.findIdByJobId(jobId).orElse(null);
        Integer coveredUntilMs = job.getStatus() == JobStatus.PARTIAL
                ? ChunkCoverage.coveredUntilMs(jobChunkRepository.findByJob_IdOrderByChunkIndexAsc(jobId))
                : null;
        return JobStatusResponse.finished(job, descriptionId, coveredUntilMs);
    }

    /**
     * 요청을 남긴 회원(generation_requests)과 관리자만 볼 수 있다. 실패 뒤 다른 회원이 다시 요청해 만든 작업도
     * 같은 영상을 요청한 회원에게는 '내 영상'에 진행 중으로 보이므로 영상 기준으로도 허용한다
     */
    public Job getViewableJob(AuthUser authUser, Long jobId) {
        Job job = jobRepository.findById(jobId)
                .orElseThrow(() -> new BusinessException(ErrorCode.JOB_NOT_FOUND));
        if (authUser.role() != Role.ADMIN && !generationRequestService.hasRequested(authUser.userId(), jobId)
                && !generationRequestService.hasRequestedVideo(authUser.userId(), job.getVideo().getId())) {
            throw new BusinessException(ErrorCode.FORBIDDEN);
        }
        return job;
    }

    /** Redis 진행 상태. 못 읽으면 DB 값으로(Redis 장애로 작업 조회·SSE 구독이 500이 되지 않게) */
    private JobProgress storedProgress(Job job) {
        try {
            return progressStore.find(job.getId()).orElseGet(() -> JobProgress.from(job));
        } catch (RuntimeException e) {
            log.warn("job 진행 상태 읽기 실패, DB 값으로 jobId={}: {}", job.getId(), e.getMessage());
            return JobProgress.from(job);
        }
    }
}
