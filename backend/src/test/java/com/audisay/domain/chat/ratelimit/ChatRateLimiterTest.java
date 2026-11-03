package com.audisay.domain.chat.ratelimit;

import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ChatRateLimiterTest {
    private StringRedisTemplate redisTemplate;
    private ValueOperations<String, String> values;
    private ChatRateLimiter limiter;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        redisTemplate = mock(StringRedisTemplate.class);
        values = mock(ValueOperations.class);
        when(redisTemplate.opsForValue()).thenReturn(values);
        limiter = new ChatRateLimiter(redisTemplate, new ChatRateLimitProperties(30, 10), new SimpleMeterRegistry());
    }

    @Test
    void 그_분의_첫_호출이면_2분_뒤_지워지게_한다() {
        when(values.increment(startsWith("chat:rate:req:2:"))).thenReturn(1L);

        limiter.acquireRequest(2L);

        verify(redisTemplate).expire(startsWith("chat:rate:req:2:"), eq(Duration.ofMinutes(2)));
    }

    @Test
    void 한도까지는_통과하고_넘으면_CHAT_009() {
        when(values.increment(startsWith("chat:rate:req:2:"))).thenReturn(30L, 31L);

        assertThatCode(() -> limiter.acquireRequest(2L)).doesNotThrowAnyException();
        assertThatThrownBy(() -> limiter.acquireRequest(2L))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode").isEqualTo(ErrorCode.CHAT_RATE_LIMIT);
    }

    @Test
    void LLM_호출은_따로_10번까지() {
        when(values.increment(startsWith("chat:rate:llm:2:"))).thenReturn(11L);

        assertThatThrownBy(() -> limiter.acquireLlm(2L))
                .extracting("errorCode").isEqualTo(ErrorCode.CHAT_RATE_LIMIT);
    }

    @Test
    void Redis가_안_되면_막지_않는다() {
        when(values.increment(anyString())).thenThrow(new RedisConnectionFailureException("down"));

        assertThatCode(() -> limiter.acquireRequest(2L)).doesNotThrowAnyException();
        verify(redisTemplate, never()).expire(anyString(), org.mockito.ArgumentMatchers.any(Duration.class));
    }
}
