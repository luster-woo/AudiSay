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
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class JobQueryService {
    private final JobRepository jobRepository;
    private final JobChunkRepository jobChunkRepository;
    private final JobProgressStore progressStore;
    private final GenerationRequestService generationRequestService;
    private final DescriptionService descriptionService;

    public JobStatusResponse getJob(AuthUser authUser, Long jobId) {
        Job job = getViewableJob(authUser, jobId);
        if (!job.isFinished()) {
            JobProgress progress = progressStore.find(jobId).orElseGet(() -> JobProgress.from(job));
            return JobStatusResponse.inProgress(job, progress);
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

    /** 요청을 남긴 회원(generation_requests)과 관리자만 볼 수 있다 */
    public Job getViewableJob(AuthUser authUser, Long jobId) {
        Job job = jobRepository.findById(jobId)
                .orElseThrow(() -> new BusinessException(ErrorCode.JOB_NOT_FOUND));
        if (authUser.role() != Role.ADMIN && !generationRequestService.hasRequested(authUser.userId(), jobId)) {
            throw new BusinessException(ErrorCode.FORBIDDEN);
        }
        return job;
    }
}
