package com.audisay.domain.job.service;

import com.audisay.domain.job.entity.JobStatus;
import com.audisay.domain.job.repository.JobRepository;
import com.audisay.global.config.JobProperties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;

/**
 * 워커가 죽거나 메시지를 잃어 QUEUED·RUNNING으로 멈춘 작업을 FAILED(AI_TIMEOUT)로 바꾼다.
 * 영상당 진행 중 작업은 하나뿐이라(uq_jobs_active_video) 멈춘 작업이 남으면 다시 요청할 수 없다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class StaleJobCleaner {
    private static final int BATCH_SIZE = 100;
    /** 한 주기에 보는 최대 후보 수 = BATCH_SIZE × MAX_PAGES. 나머지는 다음 주기에 */
    private static final int MAX_PAGES = 10;

    private final JobRepository jobRepository;
    private final JobEventService jobEventService;
    private final JobProperties jobProperties;

    @Scheduled(fixedDelay = 300_000, initialDelay = 120_000)
    public void cleanUp() {
        if (jobProperties.stale().enabled()) {
            cleanUp(Instant.now());
        }
    }

    /**
     * 작업마다 트랜잭션을 따로 열어, 하나가 실패해도 나머지는 정리한다. 실패한 작업은 다음 주기에 다시 본다.
     *
     * @return FAILED로 바꾼 작업 수
     */
    int cleanUp(Instant now) {
        JobProperties.Stale stale = jobProperties.stale();
        Instant queuedBefore = now.minus(stale.queuedTimeout());
        Instant runningBefore = now.minus(stale.runningTimeout());
        int candidates = 0;
        int failed = 0;
        Long afterId = 0L;
        for (int page = 0; page < MAX_PAGES; page++) {
            List<Long> jobIds = jobRepository.findStaleCandidateIds(JobStatus.QUEUED, queuedBefore,
                    JobStatus.RUNNING, runningBefore, afterId, PageRequest.of(0, BATCH_SIZE));
            for (Long jobId : jobIds) {
                try {
                    if (jobEventService.failIfStale(jobId, queuedBefore, runningBefore)) {
                        failed++;
                    }
                } catch (RuntimeException e) {
                    log.warn("[작업 정리] 실패, 다음 주기에 다시 시도 jobId={}: {}", jobId, e.getMessage());
                }
            }
            candidates += jobIds.size();
            if (jobIds.size() < BATCH_SIZE) {
                break;
            }
            afterId = jobIds.get(jobIds.size() - 1);
        }
        if (failed > 0) {
            log.info("[작업 정리] 후보 {}개 중 {}개 FAILED", candidates, failed);
        }
        return failed;
    }
}
