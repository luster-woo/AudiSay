package com.audisay.domain.job.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.Duration;
import java.util.UUID;

/**
 * 롤백된 처리까지 버리지 않도록 커밋 후에 기록한다.
 * Redis 장애면 중복 확인을 건너뛰고 처리한다(중복은 작업 행 잠금·상태 확인으로 한 번 더 막히고, 메시지를 버리는 것보다 낫다)
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class JobEventDeduplicator {
    private static final String KEY_PREFIX = "job:event:done:";
    private static final Duration TTL = Duration.ofDays(1);

    private final StringRedisTemplate redisTemplate;

    public boolean isProcessed(UUID messageId) {
        try {
            return Boolean.TRUE.equals(redisTemplate.hasKey(KEY_PREFIX + messageId));
        } catch (DataAccessException e) {
            log.warn("job 이벤트 중복 확인 실패, 처리 진행 messageId={}: {}", messageId, e.getMessage());
            return false;
        }
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
        try {
            redisTemplate.opsForValue().set(KEY_PREFIX + messageId, "1", TTL);
        } catch (DataAccessException e) {
            // 커밋 뒤라 예외를 올리면 이미 끝난 처리를 다시 시도하게 된다
            log.warn("job 이벤트 처리 기록 실패 messageId={}: {}", messageId, e.getMessage());
        }
    }
}
