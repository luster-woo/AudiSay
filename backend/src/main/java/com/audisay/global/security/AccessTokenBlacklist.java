package com.audisay.global.security;

import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * 로그아웃한 AccessToken을 남은 시간 동안 막는다.
 * 로그인할 때마다 sid가 새로 생기므로 토큰 대신 sid를 막는다.
 */
@Component
@RequiredArgsConstructor
public class AccessTokenBlacklist {
    private static final String KEY_PREFIX = "blacklist:";

    private final StringRedisTemplate redisTemplate;

    public void add(String sid, Duration ttl) {
        if (ttl.isNegative() || ttl.isZero()) {
            return;
        }
        redisTemplate.opsForValue().set(KEY_PREFIX + sid, "1", ttl);
    }

    public boolean contains(String sid) {
        return Boolean.TRUE.equals(redisTemplate.hasKey(KEY_PREFIX + sid));
    }
}
