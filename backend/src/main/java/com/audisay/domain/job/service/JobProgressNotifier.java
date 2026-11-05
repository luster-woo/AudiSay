package com.audisay.domain.job.service;

import com.audisay.domain.job.dto.JobNotice;
import com.audisay.domain.job.dto.JobProgress;
import com.audisay.domain.job.entity.Job;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;

/** DB 커밋 후 Redis 진행 상태를 갱신하고 job:events:{jobId} 채널로 알린다 */
@Slf4j
@Component
@RequiredArgsConstructor
public class JobProgressNotifier {
    private static final String CHANNEL_PREFIX = "job:events:";
    public static final String CHANNEL_PATTERN = CHANNEL_PREFIX + "*";

    private final JobProgressStore progressStore;
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;

    public void progress(Job job) {
        progress(job, job.getProgress());
    }

    public void progress(Job job, int progress) {
        afterCommit(job.getId(), JobNotice.progress(job, Math.max(progress, storedProgress(job.getId()))));
    }

    /** Redis에 남은 진행률(줄지 않게). 못 읽으면 0 → DB 값으로 알린다(알림 때문에 이벤트 처리를 실패시키지 않는다) */
    private int storedProgress(Long jobId) {
        try {
            return progressStore.find(jobId).map(JobProgress::progress).orElse(0);
        } catch (RuntimeException e) {
            log.warn("job 진행 상태 읽기 실패 jobId={}: {}", jobId, e.getMessage());
            return 0;
        }
    }

    public void completed(Job job, Long descriptionId, Integer coveredUntilMs) {
        afterCommit(job.getId(), JobNotice.completed(job, descriptionId, coveredUntilMs));
    }

    public void failed(Job job) {
        afterCommit(job.getId(), JobNotice.failed(job));
    }

    public static String channel(Long jobId) {
        return CHANNEL_PREFIX + jobId;
    }

    private void afterCommit(Long jobId, JobNotice notice) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            send(jobId, notice);
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                send(jobId, notice);
            }
        });
    }

    private void send(Long jobId, JobNotice notice) {
        try {
            if (notice.isFinished()) {
                progressStore.delete(jobId);
            } else {
                progressStore.save(jobId,
                        new JobProgress(notice.status(), notice.currentStage(), notice.progress(), Instant.now()));
            }
            redisTemplate.convertAndSend(channel(jobId), objectMapper.writeValueAsString(notice));
        } catch (RuntimeException e) {
            log.warn("job 진행 상태 알림 실패 jobId={} event={}: {}", jobId, notice.event(), e.getMessage());
        }
    }
}
