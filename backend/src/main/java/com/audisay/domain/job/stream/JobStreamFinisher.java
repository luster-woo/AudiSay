package com.audisay.domain.job.stream;

import com.audisay.domain.job.dto.response.JobStatusResponse;
import com.audisay.domain.job.service.JobQueryService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.Set;

/**
 * 끝 알림(completed/failed)은 Redis Pub/Sub이라 끝나는 순간 Redis가 잠깐 끊기면 다시 오지 않는다. 그러면 SSE는 heartbeat만 보내며
 * 최대 6시간 열려 있고 FE 진행 화면이 멈춘다. 1분마다 이 서버 구독자의 작업을 DB에서 보고, 이미 끝났으면 최종 상태를 보내고 닫는다
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class JobStreamFinisher {
    private final JobSseEmitters emitters;
    private final JobQueryService jobQueryService;

    @Scheduled(fixedDelay = 60_000, initialDelay = 60_000)
    public void finishMissed() {
        Set<Long> jobIds = emitters.jobIds();
        if (jobIds.isEmpty()) {
            return;
        }
        try {
            for (JobStatusResponse finished : jobQueryService.findFinished(jobIds)) {
                log.info("끝 알림을 놓친 작업 SSE를 닫음 jobId={} status={}", finished.jobId(), finished.status());
                emitters.send(finished.jobId(), JobStreamEvent.from(finished));
            }
        } catch (RuntimeException e) {
            log.warn("작업 SSE 끝 상태 확인 실패, 다음 주기에 다시: {}", e.getMessage());
        }
    }
}
