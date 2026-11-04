package com.audisay.domain.job.stream;

import com.audisay.domain.job.dto.JobProgress;
import com.audisay.domain.job.entity.JobStatus;
import com.audisay.domain.job.service.JobProgressStore;
import com.audisay.domain.job.service.JobTimeEstimator;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 진행 중 작업의 남은 시간을 15초마다 다시 계산해 SSE progress 로 보낸다.
 * progress 는 단계가 바뀌거나 10% 구간을 넘을 때만 나가서(NFR-04) 그 사이 화면의 남은 시간이 멈춰 있었다.
 * 단계·진행률은 그대로라 화면의 읽어 주기(단계·10% 단위)는 늘지 않는다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class JobRemainingTicker {
    private final JobSseEmitters emitters;
    private final JobProgressStore progressStore;
    private final JobTimeEstimator timeEstimator;

    @Scheduled(fixedRate = 15_000, initialDelay = 15_000)
    public void tick() {
        for (Long jobId : emitters.jobIds()) {
            try {
                progressStore.find(jobId)
                        .filter(p -> p.status() == JobStatus.QUEUED || p.status() == JobStatus.RUNNING)
                        .ifPresent(p -> emitters.refresh(jobId, event(jobId, p)));
            } catch (RuntimeException e) {
                log.debug("남은 시간 갱신 실패 jobId={}: {}", jobId, e.getMessage());
            }
        }
    }

    private JobStreamEvent event(Long jobId, JobProgress p) {
        return JobStreamEvent.progress(p.status(), p.currentStage(), p.progress(), timeEstimator.estimate(jobId, p.progress()));
    }
}
