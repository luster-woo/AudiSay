package com.audisay.global.security;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AccessTokenBlacklistTest {

    @Test
    void Redis가_끊겨도_예외를_던지지_않고_막지_않는다() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        when(redis.hasKey("blacklist:sid")).thenThrow(new RedisConnectionFailureException("down"));

        assertThat(new AccessTokenBlacklist(redis).contains("sid")).isFalse();
    }

    @Test
    void 막힌_sid면_true() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        when(redis.hasKey("blacklist:sid")).thenReturn(true);

        assertThat(new AccessTokenBlacklist(redis).contains("sid")).isTrue();
    }
}
