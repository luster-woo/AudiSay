package com.audisay.domain.job.service;

import com.audisay.domain.job.entity.Job;
import com.audisay.domain.job.entity.JobStatus;
import com.audisay.domain.job.entity.Pipeline;
import com.audisay.domain.job.repository.JobRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Objects;

/**
 * 해설 만들기 예상 전체 시간·남은 시간(초).
 * <ul>
 *   <li>예상 전체: 같은 경로(GEMINI_URL·LOCAL)로 최근 끝난 작업 10개의 "걸린 시간 ÷ 영상 길이" 중앙값 × 이 영상 길이.
 *       기록이 없으면 실측 평균(유튜브 0.45배, 업로드 1.4배)</li>
 *   <li>남은 시간: 처음엔 예상에서 지난 시간을 빼고, 진행률 35~85%에서 실제 진행 속도(지난 시간 × 남은 % ÷ 끝낸 %)로
 *       천천히 넘어간다. 한 번에 바꾸면 숫자가 툭 튄다</li>
 * </ul>
 * 진행 중 화면이 "남은 시간을 계산하고 있어요"만 보이던 것(estimatedRemainingSec 이 늘 null)을 채운다.
 */
@Component
@RequiredArgsConstructor
public class JobTimeEstimator {
    static final double GEMINI_URL_SEC_PER_VIDEO_SEC = 0.45;
    static final double LOCAL_SEC_PER_VIDEO_SEC = 1.4;
    private static final int BLEND_FROM = 35;
    private static final int BLEND_SPAN = 50;

    private final JobRepository jobRepository;

    public record Estimate(Integer totalSec, Integer remainingSec) {
        public static final Estimate NONE = new Estimate(null, null);
    }

    @Transactional(readOnly = true)
    public Estimate estimate(Long jobId, int progress) {
        return jobRepository.findById(jobId).map(job -> estimate(job, progress)).orElse(Estimate.NONE);
    }

    public Estimate estimate(Job job, int progress) {
        Integer durationSec = job.getVideo().getDurationSec();
        if (job.isFinished() || durationSec == null || durationSec <= 0) {
            return Estimate.NONE;
        }
        int expected = (int) Math.round(durationSec * ratio(job.getPipeline()));
        long elapsed = job.getStartedAt() == null ? 0 : Math.max(0, Duration.between(job.getStartedAt(), Instant.now()).toSeconds());
        int remaining = remaining(elapsed, expected, progress);
        return new Estimate((int) elapsed + remaining, remaining);
    }

    /** 예상과 실제 진행 속도를 섞은 남은 시간(초) */
    static int remaining(long elapsedSec, int expectedSec, int progress) {
        double byEstimate = Math.max(0, expectedSec - elapsedSec);
        double byRate = progress > 0 ? elapsedSec * (100.0 - progress) / progress : byEstimate;
        double w = Math.min(1, Math.max(0, (progress - BLEND_FROM) / (double) BLEND_SPAN));
        return (int) Math.max(0, Math.round((1 - w) * byEstimate + w * byRate));
    }

    /** 걸린 시간 ÷ 영상 길이: 같은 경로 최근 성공 작업의 중앙값 */
    double ratio(Pipeline pipeline) {
        List<Double> ratios = jobRepository.findTop10ByPipelineAndStatusOrderByIdDesc(pipeline, JobStatus.SUCCEEDED).stream()
                .map(j -> {
                    Integer d = j.getVideo().getDurationSec();
                    if (j.getStartedAt() == null || j.getFinishedAt() == null || d == null || d <= 0) {
                        return null;
                    }
                    return Duration.between(j.getStartedAt(), j.getFinishedAt()).toMillis() / 1000.0 / d;
                })
                .filter(Objects::nonNull)
                .sorted()
                .toList();
        if (ratios.isEmpty()) {
            return pipeline == Pipeline.LOCAL ? LOCAL_SEC_PER_VIDEO_SEC : GEMINI_URL_SEC_PER_VIDEO_SEC;
        }
        return ratios.get(ratios.size() / 2);
    }
}
