package com.audisay.domain.chat.answer;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * 같은 chatLogId 답변을 두 번 만들지 않게(CHAT_008) Redis에 표시한다. 서버가 죽어도 TTL이 지나면 풀린다.
 * Redis 장애면 막지 않고 진행한다(입력 제한과 같은 방침)
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AnswerInProgress {
    private static final String KEY = "chat:answer:%d";

    private final StringRedisTemplate redisTemplate;

    /** @return false면 이미 만드는 중 */
    public boolean start(Long chatLogId, Duration ttl) {
        try {
            return Boolean.TRUE.equals(redisTemplate.opsForValue().setIfAbsent(KEY.formatted(chatLogId), "1", ttl));
        } catch (DataAccessException e) {
            log.warn("[CHAT] 답변 진행 표시 실패 chatLogId={}: {}", chatLogId, e.getMessage());
            return true;
        }
    }

    public void finish(Long chatLogId) {
        try {
            redisTemplate.delete(KEY.formatted(chatLogId));
        } catch (DataAccessException e) {
            log.warn("[CHAT] 답변 진행 표시 해제 실패 chatLogId={}: {}", chatLogId, e.getMessage());
        }
    }
}
