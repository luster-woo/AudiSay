package com.audisay.domain.chat.answer;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * "지금 이후 내용, 들으시겠어요?"를 물은 답변 표시(Redis chat:future:{chatLogId}, 30분). includeFuture 재구독은 표시가 있을 때 한 번만.
 * Redis 장애면 표시를 못 남겨 "들을게요"가 CHAT_010이 된다(답변 자체는 막지 않음)
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class FutureOffer {
    static final Duration TTL = Duration.ofMinutes(30);
    private static final String KEY = "chat:future:%d";

    private final StringRedisTemplate redisTemplate;

    public void offer(Long chatLogId) {
        try {
            redisTemplate.opsForValue().set(KEY.formatted(chatLogId), "1", TTL);
        } catch (DataAccessException e) {
            log.warn("[CHAT] 지금 이후 내용 표시 실패 chatLogId={}: {}", chatLogId, e.getMessage());
        }
    }

    public boolean exists(Long chatLogId) {
        try {
            return Boolean.TRUE.equals(redisTemplate.hasKey(KEY.formatted(chatLogId)));
        } catch (DataAccessException e) {
            log.warn("[CHAT] 지금 이후 내용 표시 확인 실패 chatLogId={}: {}", chatLogId, e.getMessage());
            return false;
        }
    }

    /** 표시를 지우고 있었으면 true(같은 답변을 두 번 다시 만들지 않게) */
    public boolean take(Long chatLogId) {
        try {
            return Boolean.TRUE.equals(redisTemplate.delete(KEY.formatted(chatLogId)));
        } catch (DataAccessException e) {
            log.warn("[CHAT] 지금 이후 내용 표시 지우기 실패 chatLogId={}: {}", chatLogId, e.getMessage());
            return false;
        }
    }
}
