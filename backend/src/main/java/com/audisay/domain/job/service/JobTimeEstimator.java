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
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/**
 * 해설 만들기 예상 전체 시간·남은 시간(초).
 * <ul>
 *   <li>예상 전체: 고정 시간 + 영상 길이 × 비율. 같은 경로(GEMINI_URL·LOCAL)로 최근 끝난 작업 20개에 이상치에 강하게
 *       맞춘다(Theil–Sen: 두 작업씩 기울기의 중앙값, 고정 시간은 나머지의 중앙값). 걸린 시간이 길이의 0.05배보다 짧은 기록
 *       (캐시·테스트로 끝난 작업)은 뺀다. 길이가 다른 기록이 없으면 기본 비율로 고정 시간만 맞추고, 기록이 없으면 기본값
 *       (유튜브 25초 + 0.07배 — 배포 33초 영상 27초·약 5분 47초 영상 48초, 업로드 1.4배)</li>
 *   <li>남은 시간: 처음엔 예상에서 지난 시간을 빼고, 진행률 35~85%에서 실제 진행 속도(지난 시간 × 남은 % ÷ 끝낸 %)로
 *       천천히 넘어간다. 한 번에 바꾸면 숫자가 툭 튄다. 예상을 넘겼으면 35% 전엔 알 수 없어 null(화면은 "계산하고 있어요"),
 *       그 뒤엔 실제 진행 속도만 쓴다</li>
 * </ul>
 */
@Component
@RequiredArgsConstructor
public class JobTimeEstimator {
    static final Model GEMINI_URL_DEFAULT = new Model(25, 0.07);
    static final Model LOCAL_DEFAULT = new Model(0, 1.4);
    static final double MIN_SEC_PER_VIDEO_SEC = 0.05;
    /** 기울기를 잴 두 작업의 길이 차이 하한(초). 길이가 거의 같으면 기울기가 튄다 */
    static final int MIN_DURATION_GAP_SEC = 30;
    private static final int BLEND_FROM = 35;
    private static final int BLEND_SPAN = 50;

    private final JobRepository jobRepository;

    public record Estimate(Integer totalSec, Integer remainingSec) {
        public static final Estimate NONE = new Estimate(null, null);
    }

    /** 걸린 시간 = fixedSec + 영상 길이 × secPerVideoSec */
    record Model(double fixedSec, double secPerVideoSec) {
        int expectedSec(int durationSec) {
            return (int) Math.round(fixedSec + secPerVideoSec * durationSec);
        }
    }

    /** 끝난 작업 하나: 영상 길이·걸린 시간(초) */
    record Sample(double durationSec, double elapsedSec) {
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
        int expected = model(job.getPipeline()).expectedSec(durationSec);
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

    Model model(Pipeline pipeline) {
        List<Sample> samples = jobRepository.findTop20ByPipelineAndStatusOrderByIdDesc(pipeline, JobStatus.SUCCEEDED).stream()
                .map(j -> {
                    Integer d = j.getVideo().getDurationSec();
                    if (j.getStartedAt() == null || j.getFinishedAt() == null || d == null || d <= 0) {
                        return null;
                    }
                    return new Sample(d, Duration.between(j.getStartedAt(), j.getFinishedAt()).toMillis() / 1000.0);
                })
                .filter(Objects::nonNull)
                .toList();
        return fit(samples, pipeline == Pipeline.LOCAL ? LOCAL_DEFAULT : GEMINI_URL_DEFAULT);
    }

    /** 너무 빠른 기록을 빼고 Theil–Sen으로 맞춘다. 기울기를 못 재면 기본 비율, 기록이 없으면 기본값 */
    static Model fit(List<Sample> samples, Model fallback) {
        List<Sample> valid = samples.stream()
                .filter(s -> s.elapsedSec() >= MIN_SEC_PER_VIDEO_SEC * s.durationSec())
                .toList();
        if (valid.isEmpty()) {
            return fallback;
        }
        List<Double> slopes = new ArrayList<>();
        for (int i = 0; i < valid.size(); i++) {
            for (int j = i + 1; j < valid.size(); j++) {
                Sample a = valid.get(i);
                Sample b = valid.get(j);
                double gap = b.durationSec() - a.durationSec();
                if (Math.abs(gap) >= MIN_DURATION_GAP_SEC) {
                    slopes.add((b.elapsedSec() - a.elapsedSec()) / gap);
                }
            }
        }
        double slope = slopes.isEmpty() ? fallback.secPerVideoSec() : Math.max(0, median(slopes));
        double fixed = Math.max(0, median(valid.stream().map(s -> s.elapsedSec() - slope * s.durationSec()).toList()));
        return new Model(fixed, slope);
    }

    private static double median(List<Double> values) {
        List<Double> sorted = values.stream().sorted().toList();
        int n = sorted.size();
        return n % 2 == 1 ? sorted.get(n / 2) : (sorted.get(n / 2 - 1) + sorted.get(n / 2)) / 2;
    }
}
