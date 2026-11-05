package com.audisay.domain.user.verification;

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
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class VerificationAttemptLimiterTest {
    private StringRedisTemplate redisTemplate;
    private ValueOperations<String, String> values;
    private VerificationAttemptLimiter limiter;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        redisTemplate = mock(StringRedisTemplate.class);
        values = mock(ValueOperations.class);
        when(redisTemplate.opsForValue()).thenReturn(values);
        limiter = new VerificationAttemptLimiter(redisTemplate, new VerificationProperties(5), new SimpleMeterRegistry());
    }

    @Test
    void 다섯_번까지_통과하고_여섯_번째는_USER_007() {
        when(values.increment(startsWith("user:verify:attempt:2:"))).thenReturn(5L, 6L);

        assertThatCode(() -> limiter.acquire(2L)).doesNotThrowAnyException();
        assertThatThrownBy(() -> limiter.acquire(2L))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode").isEqualTo(ErrorCode.VERIFICATION_ATTEMPT_LIMIT);
    }

    @Test
    void 키는_2일_뒤_지워진다() {
        when(values.increment(startsWith("user:verify:attempt:2:"))).thenReturn(1L);

        limiter.acquire(2L);

        verify(redisTemplate).expire(startsWith("user:verify:attempt:2:"), eq(Duration.ofDays(2)));
    }

    @Test
    void Redis가_안_되면_막지_않는다() {
        when(values.increment(startsWith("user:verify:attempt:2:")))
                .thenThrow(new RedisConnectionFailureException("down"));

        assertThatCode(() -> limiter.acquire(2L)).doesNotThrowAnyException();
    }
}
