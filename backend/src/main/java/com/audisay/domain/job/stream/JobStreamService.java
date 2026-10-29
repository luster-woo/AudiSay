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
    private static final long TIMEOUT_MS = Duration.ofMinutes(30).toMillis();

    private final JobQueryService jobQueryService;
    private final JobSseEmitters emitters;

    /** 구독을 먼저 등록하고 현재 상태를 보내야 그 사이에 온 이벤트를 놓치지 않는다 */
    public SseEmitter subscribe(AuthUser authUser, Long jobId) {
        jobQueryService.getViewableJob(authUser, jobId);
        SseEmitter emitter = new SseEmitter(TIMEOUT_MS);
        JobSseEmitters.Subscriber subscriber = emitters.add(jobId, emitter);
        JobStatusResponse current = jobQueryService.getJob(authUser, jobId);
        subscriber.send(JobStreamEvent.from(current));
        return emitter;
    }
}
