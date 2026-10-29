package com.audisay.domain.job.service;

import com.audisay.domain.job.entity.Job;
import com.audisay.domain.job.entity.JobType;
import com.audisay.domain.job.message.MessageType;
import com.audisay.domain.job.message.payload.PreparePayload;
import com.audisay.domain.job.repository.JobRepository;
import com.audisay.domain.user.entity.User;
import com.audisay.domain.video.entity.Video;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * 해설 생성 작업을 만들고 첫 단계(job.prepare)를 넣는다. 다음 단계는 워커 이벤트를 받는 쪽이 이어 간다.
 * 해설(descriptions) 행은 워커가 job.merge에서 만든다.
 */
@Service
@RequiredArgsConstructor
public class JobLauncher {
    private final JobRepository jobRepository;
    private final JobMessagePublisher jobMessagePublisher;

    /**
     * 호출한 쪽 트랜잭션 안에서 작업(QUEUED)과 발행할 메시지를 함께 저장한다. 메시지는 커밋 후 발행된다.
     * 이미 진행 중인 작업이 있으면 JOB_002.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public Job launch(Video video, User requestedBy, JobType jobType, PreparePayload payload) {
        Job job = Job.create(video, requestedBy, jobType, payload.pipeline());
        try {
            jobRepository.saveAndFlush(job);
        } catch (DataIntegrityViolationException e) {
            // 같은 영상의 QUEUED·RUNNING 작업이 있어 uq_jobs_active_video에 걸린 경우
            throw new BusinessException(ErrorCode.JOB_ALREADY_RUNNING);
        }
        jobMessagePublisher.publish(job.getId(), MessageType.JOB_PREPARE, payload);
        return job;
    }
}
