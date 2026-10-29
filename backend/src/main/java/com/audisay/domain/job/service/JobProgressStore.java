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

    public void delete(Long jobId) {
        redisTemplate.delete(key(jobId));
    }

    private static String key(Long jobId) {
        return KEY_PREFIX + jobId;
    }
}
