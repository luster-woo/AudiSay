package com.audisay.domain.job.service;

import com.audisay.domain.job.dto.JobProgress;
import com.audisay.domain.job.entity.JobStage;
import com.audisay.domain.job.entity.JobStatus;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

@Component
@RequiredArgsConstructor
public class JobProgressStore {
    private static final String KEY_PREFIX = "job:progress:";
    private static final Duration TTL = Duration.ofDays(1);

    private static final String STATUS = "status";
    private static final String CURRENT_STAGE = "currentStage";
    private static final String PROGRESS = "progress";
    private static final String UPDATED_AT = "updatedAt";
    private static final String STAGE_STARTED_AT = "stageStartedAt";

    private final StringRedisTemplate redisTemplate;

    public void save(Long jobId, JobProgress progress) {
        Map<String, String> fields = new HashMap<>();
        fields.put(STATUS, progress.status().name());
        if (progress.currentStage() != null) {
            fields.put(CURRENT_STAGE, progress.currentStage().name());
        }
        fields.put(PROGRESS, String.valueOf(progress.progress()));
        fields.put(UPDATED_AT, progress.updatedAt().toString());

        String key = key(jobId);
        // 단계가 바뀐 첫 저장의 시각을 단계 시작으로 남긴다(남은 시간 계산, JobTimeEstimator)
        if (progress.currentStage() != null
                && !progress.currentStage().name().equals(redisTemplate.opsForHash().get(key, CURRENT_STAGE))) {
            fields.put(STAGE_STARTED_AT, progress.updatedAt().toString());
        }
        redisTemplate.opsForHash().putAll(key, fields);
        redisTemplate.expire(key, TTL);
    }

    public Optional<JobProgress> find(Long jobId) {
        Map<Object, Object> fields = redisTemplate.opsForHash().entries(key(jobId));
        if (fields.isEmpty()) {
            return Optional.empty();
        }
        Object stage = fields.get(CURRENT_STAGE);
        return Optional.of(new JobProgress(
                JobStatus.valueOf((String) fields.get(STATUS)),
                stage == null ? null : JobStage.valueOf((String) stage),
                Integer.parseInt((String) fields.get(PROGRESS)),
                Instant.parse((String) fields.get(UPDATED_AT))
        ));
    }

    /** 지금 단계가 시작된 시각. 기록이 없으면(Redis를 비웠거나 이 기능 전 작업) 빈 값 */
    public Optional<Instant> stageStartedAt(Long jobId) {
        Object value = redisTemplate.opsForHash().get(key(jobId), STAGE_STARTED_AT);
        return value == null ? Optional.empty() : Optional.of(Instant.parse((String) value));
    }

    public void delete(Long jobId) {
        redisTemplate.delete(key(jobId));
    }

    private static String key(Long jobId) {
        return KEY_PREFIX + jobId;
    }
}
