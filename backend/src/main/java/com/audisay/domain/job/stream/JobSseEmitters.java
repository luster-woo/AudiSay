package com.audisay.domain.job.stream;

import com.audisay.domain.job.entity.JobStage;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/** 이 서버에 연결된 작업 SSE 구독자. 다른 서버의 구독자는 Redis Pub/Sub으로 각 서버가 직접 보낸다 */
@Slf4j
@Component
public class JobSseEmitters {
    private static final int PROGRESS_STEP = 10;

    private final Map<Long, Set<Subscriber>> subscribers = new ConcurrentHashMap<>();

    public JobSseEmitters(MeterRegistry meterRegistry) {
        Gauge.builder("audisay.job.sse.connections", this, JobSseEmitters::count).register(meterRegistry);
    }

    Subscriber add(Long jobId, SseEmitter emitter) {
        Subscriber subscriber = new Subscriber(jobId, emitter);
        subscribers.computeIfAbsent(jobId, id -> ConcurrentHashMap.newKeySet()).add(subscriber);
        emitter.onCompletion(() -> remove(subscriber));
        emitter.onTimeout(() -> {
            remove(subscriber);
            emitter.complete();
        });
        emitter.onError(e -> remove(subscriber));
        return subscriber;
    }

    void send(Long jobId, JobStreamEvent event) {
        Set<Subscriber> set = subscribers.get(jobId);
        if (set == null) {
            return;
        }
        for (Subscriber subscriber : set) {
            subscriber.send(event);
        }
    }

    /** 구독자가 있는 작업 */
    Set<Long> jobIds() {
        return Set.copyOf(subscribers.keySet());
    }

    /** 남은 시간만 새로 담은 progress 를 10% 구간과 상관없이 보낸다(화면의 남은 시간이 이벤트 사이에도 줄게) */
    void refresh(Long jobId, JobStreamEvent event) {
        Set<Subscriber> set = subscribers.get(jobId);
        if (set != null && !event.isFinished()) {
            set.forEach(s -> s.write(event));
        }
    }

    @Scheduled(fixedRate = 15_000)
    public void heartbeat() {
        subscribers.values().forEach(set -> set.forEach(Subscriber::heartbeat));
    }

    private void remove(Subscriber subscriber) {
        subscribers.computeIfPresent(subscriber.jobId, (id, set) -> {
            set.remove(subscriber);
            return set.isEmpty() ? null : set;
        });
    }

    private int count() {
        return subscribers.values().stream().mapToInt(Set::size).sum();
    }

    /** 명세(NFR-04): progress는 단계가 바뀌거나 10% 구간을 넘을 때만 보낸다 */
    final class Subscriber {
        private final Long jobId;
        private final SseEmitter emitter;
        private JobStage lastStage;
        private int lastStep = -1;

        private Subscriber(Long jobId, SseEmitter emitter) {
            this.jobId = jobId;
            this.emitter = emitter;
        }

        synchronized void send(JobStreamEvent event) {
            if (!event.isFinished()) {
                int step = event.progress() / PROGRESS_STEP;
                if (Objects.equals(event.stage(), lastStage) && step <= lastStep) {
                    return;
                }
                lastStage = event.stage();
                lastStep = step;
            }
            write(event);
        }

        synchronized void write(JobStreamEvent event) {
            try {
                emitter.send(SseEmitter.event().name(event.name()).data(event.data()));
                if (event.isFinished()) {
                    emitter.complete();
                }
            } catch (IOException | IllegalStateException e) {
                log.debug("SSE 전송 실패 jobId={}: {}", jobId, e.getMessage());
                remove(this);
            }
        }

        synchronized void heartbeat() {
            try {
                emitter.send(SseEmitter.event().comment("heartbeat"));
            } catch (IOException | IllegalStateException e) {
                remove(this);
            }
        }
    }
}
