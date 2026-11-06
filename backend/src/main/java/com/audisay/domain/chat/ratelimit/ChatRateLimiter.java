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

    /** 음성 받아쓰기 한 번(챗봇 입력과 따로 센다: 받아쓴 말을 보내는 입력이 또 세지므로). 한도는 입력과 같다 */
    public void acquireStt(Long userId) {
        acquire("stt", userId, properties.requestsPerMinute());
    }

    /** LLM 호출 한 번(발화 분류·장면 선택·다시 묻기·뒤 확인). 1분에 llmCallsPerMinute를 넘으면 CHAT_009 */
    public void acquireLlm(Long userId) {
        acquire("llm", userId, properties.llmCallsPerMinute());
    }

    private void acquire(String kind, Long userId, int limit) {
        String key = "chat:rate:" + kind + ":" + userId + ":" + clock.millis() / 60_000;
        Long count;
        try {
            count = redisTemplate.opsForValue().increment(key);
        } catch (DataAccessException e) {
            log.warn("챗봇 호출 제한을 확인하지 못해 그대로 진행합니다: {}", e.getMessage());
            return;
        }
        expire(key);
        if (count != null && count > limit) {
            meterRegistry.counter("audisay.chat.rate_limited", "kind", kind).increment();
            throw new BusinessException(ErrorCode.CHAT_RATE_LIMIT);
        }
    }

    /** 첫 INCR 뒤 EXPIRE만 실패하면 키가 영영 남으므로 매번 건다(분 단위 키라 늦어도 3분 안에 지워진다). 실패해도 한도 검사는 한다 */
    private void expire(String key) {
        try {
            redisTemplate.expire(key, TTL);
        } catch (DataAccessException e) {
            log.warn("챗봇 호출 제한 키 만료 설정 실패 key={}: {}", key, e.getMessage());
        }
    }
}
