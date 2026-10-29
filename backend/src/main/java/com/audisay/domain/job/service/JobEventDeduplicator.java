package com.audisay.domain.job.service;

import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.Duration;
import java.util.UUID;

/** 롤백된 처리까지 버리지 않도록 커밋 후에 기록한다 */
@Component
@RequiredArgsConstructor
public class JobEventDeduplicator {
    private static final String KEY_PREFIX = "job:event:done:";
    private static final Duration TTL = Duration.ofDays(1);

    private final StringRedisTemplate redisTemplate;

    public boolean isProcessed(UUID messageId) {
        return Boolean.TRUE.equals(redisTemplate.hasKey(KEY_PREFIX + messageId));
    }

    public void markProcessedAfterCommit(UUID messageId) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            markProcessed(messageId);
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                markProcessed(messageId);
            }
        });
    }

    private void markProcessed(UUID messageId) {
        redisTemplate.opsForValue().set(KEY_PREFIX + messageId, "1", TTL);
    }
}
