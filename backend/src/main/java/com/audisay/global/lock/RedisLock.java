package com.audisay.global.lock;

import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 여러 서버가 같은 일을 동시에 하지 않게 하는 Redis 락(SET NX + 만료 시간).
 * 잡은 쪽만 풀 수 있도록 값에 임의 토큰을 넣고, 풀 때 토큰이 같은지 확인한다.
 */
@Component
@RequiredArgsConstructor
public class RedisLock {
    private static final String KEY_PREFIX = "lock:";
    private static final Duration RETRY_INTERVAL = Duration.ofMillis(50);
    private static final RedisScript<Long> RELEASE = new DefaultRedisScript<>(
            "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
            Long.class);

    private final StringRedisTemplate redisTemplate;

    /**
     * wait 동안 다시 시도해도 못 잡으면 비어 있다. 잡은 락은 try-with-resources로 푼다.
     *
     * @param ttl 푸는 것을 잊거나 서버가 죽어도 이 시간이 지나면 풀린다
     */
    public Optional<Handle> tryLock(String name, Duration ttl, Duration wait) {
        String key = KEY_PREFIX + name;
        String token = UUID.randomUUID().toString();
        Instant deadline = Instant.now().plus(wait);
        while (true) {
            if (Boolean.TRUE.equals(redisTemplate.opsForValue().setIfAbsent(key, token, ttl))) {
                return Optional.of(new Handle(key, token));
            }
            if (Instant.now().isAfter(deadline)) {
                return Optional.empty();
            }
            try {
                Thread.sleep(RETRY_INTERVAL);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return Optional.empty();
            }
        }
    }

    public final class Handle implements AutoCloseable {
        private final String key;
        private final String token;

        private Handle(String key, String token) {
            this.key = key;
            this.token = token;
        }

        @Override
        public void close() {
            redisTemplate.execute(RELEASE, List.of(key), token);
        }
    }
}
