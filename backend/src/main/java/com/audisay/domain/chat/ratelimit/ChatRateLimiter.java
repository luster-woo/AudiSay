package com.audisay.domain.chat.ratelimit;

import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;

/**
 * 회원당 1분 고정 창 챗봇 호출 제한(Redis INCR). 사람이 말로 쓰는 속도로는 걸리지 않고, 자동 반복·FE 버그로 LLM 크레딧이 새는 것을 막는다.
 * 키 chat:rate:{req|llm}:{userId}:{분}, 2분 뒤 지워짐. Redis가 안 되면 막지 않는다(챗봇을 멈추는 것보다 낫다)
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ChatRateLimiter {
    private static final Duration TTL = Duration.ofMinutes(2);

    private final StringRedisTemplate redisTemplate;
    private final ChatRateLimitProperties properties;
    private final MeterRegistry meterRegistry;
    private final Clock clock = Clock.systemUTC();

    /** 챗봇 입력 한 번. 1분에 requestsPerMinute를 넘으면 CHAT_009 */
    public void acquireRequest(Long userId) {
        acquire("req", userId, properties.requestsPerMinute());
    }

    /** LLM 호출 한 번(발화 분류·장면 선택). 1분에 llmCallsPerMinute를 넘으면 CHAT_009 */
    public void acquireLlm(Long userId) {
        acquire("llm", userId, properties.llmCallsPerMinute());
    }

    private void acquire(String kind, Long userId, int limit) {
        String key = "chat:rate:" + kind + ":" + userId + ":" + clock.millis() / 60_000;
        Long count;
        try {
            count = redisTemplate.opsForValue().increment(key);
            if (count != null && count == 1) {
                redisTemplate.expire(key, TTL);
            }
        } catch (DataAccessException e) {
            log.warn("챗봇 호출 제한을 확인하지 못해 그대로 진행합니다: {}", e.getMessage());
            return;
        }
        if (count != null && count > limit) {
            meterRegistry.counter("audisay.chat.rate_limited", "kind", kind).increment();
            throw new BusinessException(ErrorCode.CHAT_RATE_LIMIT);
        }
    }
}
