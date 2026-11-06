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
 *       0.1배보다 빠른 기록(캐시·테스트로 끝난 작업)은 빼고, 남는 기록이 없으면 실측 평균(유튜브 0.45배, 업로드 1.4배)</li>
 *   <li>남은 시간: 처음엔 예상에서 지난 시간을 빼고, 진행률 35~85%에서 실제 진행 속도(지난 시간 × 남은 % ÷ 끝낸 %)로
 *       천천히 넘어간다. 한 번에 바꾸면 숫자가 툭 튄다. 예상을 넘겼으면 35% 전엔 알 수 없어 null(화면은 "계산하고 있어요"),
 *       그 뒤엔 실제 진행 속도만 쓴다</li>
 * </ul>
 * 진행 중 화면이 "남은 시간을 계산하고 있어요"만 보이던 것(estimatedRemainingSec 이 늘 null)을 채운다.
 */
@Component
@RequiredArgsConstructor
public class JobTimeEstimator {
    static final double GEMINI_URL_SEC_PER_VIDEO_SEC = 0.45;
    static final double LOCAL_SEC_PER_VIDEO_SEC = 1.4;
    static final double MIN_SEC_PER_VIDEO_SEC = 0.1;
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
        Integer remaining = remaining(elapsed, expected, progress);
        if (remaining == null) {
            return Estimate.NONE;
        }
        return new Estimate((int) elapsed + remaining, remaining);
    }

    /** 예상과 실제 진행 속도를 섞은 남은 시간(초). 35% 전에 예상을 넘겼으면 null */
    static Integer remaining(long elapsedSec, int expectedSec, int progress) {
        double byRate = progress > 0 ? elapsedSec * (100.0 - progress) / progress : 0;
        if (elapsedSec >= expectedSec) {
            return progress < BLEND_FROM ? null : (int) Math.round(byRate);
        }
        double byEstimate = expectedSec - elapsedSec;
        double w = Math.min(1, Math.max(0, (progress - BLEND_FROM) / (double) BLEND_SPAN));
        return (int) Math.round((1 - w) * byEstimate + w * byRate);
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
                .toList();
        return medianRatio(ratios, pipeline);
    }

    /** 너무 빠른 기록을 뺀 중앙값, 남는 게 없으면 기본값 */
    static double medianRatio(List<Double> ratios, Pipeline pipeline) {
        List<Double> valid = ratios.stream().filter(r -> r >= MIN_SEC_PER_VIDEO_SEC).sorted().toList();
        if (valid.isEmpty()) {
            return pipeline == Pipeline.LOCAL ? LOCAL_SEC_PER_VIDEO_SEC : GEMINI_URL_SEC_PER_VIDEO_SEC;
        }
        return valid.get(valid.size() / 2);
    }
}
