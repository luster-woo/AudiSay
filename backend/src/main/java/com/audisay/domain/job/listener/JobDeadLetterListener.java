package com.audisay.domain.job.listener;

import com.audisay.domain.job.message.JobMessage;
import com.audisay.domain.job.service.JobEventDeduplicator;
import com.audisay.domain.job.service.JobEventService;
import com.audisay.global.config.RabbitConfig;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;

/** job.dlq: 워커가 3번 시도해도 실패한 메시지. 처리 실패 시 3번까지 다시 해 보고 로그만 남긴 채 버린다(ack) */
@Slf4j
@Component
@RequiredArgsConstructor
public class JobDeadLetterListener {
    private static final int MAX_ATTEMPTS = 3;
    private static final long RETRY_INTERVAL_MS = 1_000;

    private final ObjectMapper objectMapper;
    private final JobEventDeduplicator deduplicator;
    private final JobEventService jobEventService;
    private final MeterRegistry meterRegistry;

    @RabbitListener(queues = RabbitConfig.DLQ)
    public void onMessage(Message message) {
        String body = new String(message.getBody(), StandardCharsets.UTF_8);
        JobMessage envelope;
        try {
            envelope = objectMapper.readValue(body, JobMessage.class);
        } catch (JacksonException | IllegalArgumentException e) {
            log.error("DLQ 메시지 형식 오류, 버림 x-error={} body={}",
                    message.getMessageProperties().getHeader("x-error"), body);
            count("unknown", "invalid");
            return;
        }
        if (envelope.messageId() == null || envelope.type() == null) {
            log.error("DLQ 메시지 필수 값 없음, 버림 x-error={} body={}",
                    message.getMessageProperties().getHeader("x-error"), body);
            count("unknown", "invalid");
            return;
        }
        if (deduplicator.isProcessed(envelope.messageId())) {
            count(envelope.type().name(), "duplicate");
            return;
        }
        for (int attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                jobEventService.handleDeadLetter(envelope);
                count(envelope.type().name(), "handled");
                return;
            } catch (RuntimeException e) {
                if (attempt == MAX_ATTEMPTS) {
                    log.error("DLQ 메시지 처리 실패, 버림 messageId={} jobId={} type={}",
                            envelope.messageId(), envelope.jobId(), envelope.type(), e);
                    count(envelope.type().name(), "dropped");
                    return;
                }
                log.warn("DLQ 메시지 처리 실패 {}/{} messageId={}: {}",
                        attempt, MAX_ATTEMPTS, envelope.messageId(), e.getMessage());
                sleep();
            }
        }
    }

    private void count(String type, String result) {
        meterRegistry.counter("audisay.job.dlq", "type", type, "result", result).increment();
    }

    private static void sleep() {
        try {
            Thread.sleep(RETRY_INTERVAL_MS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
