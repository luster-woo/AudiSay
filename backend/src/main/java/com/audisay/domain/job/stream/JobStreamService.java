package com.audisay.domain.job.stream;

import com.audisay.domain.job.dto.response.JobStatusResponse;
import com.audisay.domain.job.service.JobQueryService;
import com.audisay.global.security.AuthUser;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.time.Duration;

@Service
@RequiredArgsConstructor
public class JobStreamService {
    /**
     * 작업이 끝나면(completed/failed) 서버가 닫는다. 그 전에 시간이 다 되면 끝 이벤트 없이 닫혀 FE가 끝난 것으로 알고
     * 진행 화면이 멈추므로, 작업이 가장 오래 걸리는 경우(대기 2시간 정리 + 60분 업로드 분석)보다 길게 잡는다.
     * 연결은 15초 heartbeat로 유지하고, 클라이언트가 떠나면 heartbeat 실패로 정리된다
     */
    private static final long TIMEOUT_MS = Duration.ofHours(6).toMillis();

    private final JobQueryService jobQueryService;
    private final JobSseEmitters emitters;

    /** 구독을 먼저 등록하고 현재 상태를 보내야 그 사이에 온 이벤트를 놓치지 않는다 */
    public SseEmitter subscribe(AuthUser authUser, Long jobId) {
        jobQueryService.getViewableJob(authUser, jobId);
        SseEmitter emitter = new SseEmitter(TIMEOUT_MS);
        JobSseEmitters.Subscriber subscriber = emitters.add(jobId, emitter);
        try {
            JobStatusResponse current = jobQueryService.getJob(authUser, jobId);
            subscriber.send(JobStreamEvent.from(current));
        } catch (RuntimeException e) {
            // 응답으로 나가지 못한 emitter는 완료·시간 초과 콜백이 오지 않아 직접 뺀다(안 빼면 heartbeat 대상으로 계속 남는다)
            emitters.remove(subscriber);
            throw e;
        }
        return emitter;
    }
}
