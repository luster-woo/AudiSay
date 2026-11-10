package com.audisay.domain.auth.repository;

import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.Cursor;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Repository;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.Set;

/**
 * 기기(sid)별 RefreshToken. 키는 refresh:{userId}:{sid}, 값은 토큰 원문이 아니라 SHA-256 해시다.
 */
@Repository
@RequiredArgsConstructor
public class RefreshTokenRepository {
    private static final String KEY_PREFIX = "refresh:";

    private final StringRedisTemplate redisTemplate;

    public void save(Long userId, String sid, String refreshToken, Duration ttl) {
        redisTemplate.opsForValue().set(key(userId, sid), hash(refreshToken), ttl);
    }

    /**
     * 저장된 토큰과 같은지 본다. 재발급으로 이미 바뀐 이전 토큰이면 false다.
     */
    public boolean matches(Long userId, String sid, String refreshToken) {
        return hash(refreshToken).equals(redisTemplate.opsForValue().get(key(userId, sid)));
    }

    /** 이 기기(sid)에 저장된 RefreshToken이 있는지 (값과 상관없이) */
    public boolean exists(Long userId, String sid) {
        return Boolean.TRUE.equals(redisTemplate.hasKey(key(userId, sid)));
    }

    public void delete(Long userId, String sid) {
        redisTemplate.delete(key(userId, sid));
    }

    /**
     * 이 회원이 로그인해 있는 기기(sid) 목록. KEYS 대신 SCAN으로 찾는다.
     */
    public Set<String> findSids(Long userId) {
        String prefix = KEY_PREFIX + userId + ":";
        ScanOptions options = ScanOptions.scanOptions().match(prefix + "*").count(100).build();
        Set<String> sids = new HashSet<>();
        try (Cursor<String> cursor = redisTemplate.scan(options)) {
            cursor.forEachRemaining(key -> sids.add(key.substring(prefix.length())));
        }
        return sids;
    }

    private String key(Long userId, String sid) {
        return KEY_PREFIX + userId + ":" + sid;
    }

    private String hash(String token) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
