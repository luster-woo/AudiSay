package com.audisay.global.security;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * 로그아웃한 AccessToken을 남은 시간 동안 막는다.
 * 로그인할 때마다 sid가 새로 생기므로 토큰 대신 sid를 막는다.
 */
@Slf4j
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

    /**
     * Redis가 끊기면 막지 않고 넘긴다(false). 이 확인은 JWT 필터 안에서 해서 예외가 나면 GlobalExceptionHandler를
     * 거치지 않고 봉투 없는 500이 되어, 로그인한 모든 화면이 실패했다. AccessToken은 수명이 짧아(만료되면 재발급에서
     * RefreshToken을 다시 확인한다) 잠깐 넘기는 쪽을 택한다. JobEventDeduplicator 등 다른 Redis 보조 기능과 같은 방침
     */
    public boolean contains(String sid) {
        try {
            return Boolean.TRUE.equals(redisTemplate.hasKey(KEY_PREFIX + sid));
        } catch (DataAccessException e) {
            log.warn("[AUTH] Redis에 닿지 못해 AccessToken 블랙리스트 확인을 건너뜁니다: {}", e.getMessage());
            return false;
        }
    }
}
