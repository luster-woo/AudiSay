package com.audisay.domain.user.verification;

import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.LocalDate;
import java.time.ZoneId;

/**
 * 회원당 하루(KST) 인증 서류 확인 횟수 제한(Redis INCR). 형식 검사를 통과해 OCR까지 간 시도만 센다.
 * 키 user:verify:attempt:{userId}:{날짜}, 2일 뒤 지워짐. Redis가 안 되면 막지 않는다(인증을 못 하는 것보다 낫다)
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class VerificationAttemptLimiter {
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final Duration TTL = Duration.ofDays(2);

    private final StringRedisTemplate redisTemplate;
    private final VerificationProperties properties;
    private final MeterRegistry meterRegistry;

    public void acquire(Long userId) {
        String key = "user:verify:attempt:" + userId + ":" + LocalDate.now(KST);
        Long count;
        try {
            count = redisTemplate.opsForValue().increment(key);
        } catch (DataAccessException e) {
            log.warn("인증 시도 횟수를 확인하지 못해 그대로 진행합니다: {}", e.getMessage());
            return;
        }
        try {
            redisTemplate.expire(key, TTL);
        } catch (DataAccessException e) {
            log.warn("인증 시도 횟수 키 만료 설정 실패 key={}: {}", key, e.getMessage());
        }
        if (count != null && count > properties.dailyAttempts()) {
            meterRegistry.counter("audisay.verification.rate_limited").increment();
            throw new BusinessException(ErrorCode.VERIFICATION_ATTEMPT_LIMIT);
        }
    }
}
