package com.audisay.domain.job.message;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.UUID;

/**
 * 워커 메시지 봉투. ai/app/mq/envelope.py의 Envelope과 필드가 같아야 한다.
 * lastError는 워커가 DLQ로 보낼 때만 채운다.
 */
public record JobMessage(
        UUID messageId,
        MessageType type,
        Long jobId,
        int attempt,
        Instant createdAt,
        Object payload,
        Map<String, Object> lastError
) {
    public static JobMessage of(MessageType type, Long jobId, Object payload) {
        return new JobMessage(UUID.randomUUID(), type, jobId, 1,
                Instant.now().truncatedTo(ChronoUnit.SECONDS), payload, null);
    }
}
