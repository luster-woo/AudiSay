package com.audisay.domain.job.service;

import com.audisay.domain.job.entity.Job;
import com.audisay.domain.job.entity.JobStage;
import com.audisay.domain.job.entity.JobStatus;
import com.audisay.domain.job.entity.Pipeline;
import com.audisay.domain.job.repository.JobRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 해설 만들기 예상 전체 시간·남은 시간(초) — 단계별.
 * <ul>
 *   <li>단계(분석 → 조각 해설 → 합치기 → 음성)마다 "고정 초 + 영상 길이 × 비율"을 같은 경로(GEMINI_URL·LOCAL)로 최근 성공한
 *       작업 20개의 단계별 걸린 시간에 이상치에 강하게 맞춘다(Theil–Sen). 단계 경계는 outbox 메시지를 만든 시각.
 *       걸린 시간이 길이의 0.05배보다 짧은 작업(캐시·테스트)은 빼고, 기록이 없으면 기본값(유튜브는 11-06 실측)</li>
 *   <li>남은 시간 = 지금 단계 예상 − 그 단계에서 지난 시간 + 남은 단계 예상의 합. 지금 단계가 예상을 넘기면 거의 끝난 것으로 보고
 *       그 단계 예상의 10%(최소 3초)만 남긴다. 대기 중이면 모든 단계의 합</li>
 * </ul>
 * 영상 길이에 비례하지 않는 시간(유튜브는 Gemini 분석 약 40초·음성 약 15초)이 대부분이라 전체 비율 하나로는 맞지 않았다
 * (11-06 NFR-08 측정: 1분 56초·5분 13초·10분 2초 영상이 58·60·68초, 예전 예상 오차 −39·+58·+97%).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class JobTimeEstimator {
    static final List<JobStage> STAGES = List.of(JobStage.PREPARE, JobStage.DESCRIBE, JobStage.MERGE, JobStage.TTS);
    static final Map<JobStage, Model> GEMINI_URL_DEFAULT = Map.of(
            JobStage.PREPARE, new Model(42, 0.012),
            JobStage.DESCRIBE, new Model(0.5, 0),
            JobStage.MERGE, new Model(0.5, 0),
            JobStage.TTS, new Model(13, 0.005));
    /** 업로드는 실측이 없어 예전 전체 1.4배를 단계로 나눈 값 */
    static final Map<JobStage, Model> LOCAL_DEFAULT = Map.of(
            JobStage.PREPARE, new Model(20, 1.2),
            JobStage.DESCRIBE, new Model(1, 0),
            JobStage.MERGE, new Model(2, 0),
            JobStage.TTS, new Model(5, 0.15));
    static final double MIN_SEC_PER_VIDEO_SEC = 0.05;
    /** 기울기를 잴 두 작업의 길이 차이 하한(초). 길이가 거의 같으면 기울기가 튄다 */
    static final int MIN_DURATION_GAP_SEC = 30;
    static final double OVERRUN_LEFT = 0.1;
    static final int OVERRUN_MIN_SEC = 3;
    private static final Duration FIT_TTL = Duration.ofMinutes(1);

    private final JobRepository jobRepository;
    private final JobProgressStore progressStore;
    private final Map<Pipeline, Fitted> fitted = new ConcurrentHashMap<>();

    public record Estimate(Integer totalSec, Integer remainingSec) {
        public static final Estimate NONE = new Estimate(null, null);
    }

    /** 걸린 시간 = fixedSec + 영상 길이 × secPerVideoSec */
    record Model(double fixedSec, double secPerVideoSec) {
        double expectedSec(int durationSec) {
            return fixedSec + secPerVideoSec * durationSec;
        }
    }

    /** 끝난 작업의 한 단계: 영상 길이·걸린 시간(초) */
    record Sample(double durationSec, double elapsedSec) {
    }

    private record Fitted(Map<JobStage, Model> models, Instant at) {
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
        Instant now = Instant.now();
        JobStage stage = job.getStatus() == JobStatus.RUNNING ? job.getCurrentStage() : null;
        long inStage = stage == null ? 0 : secondsSince(stageStartedAt(job, stage), now);
        int remaining = remaining(models(job.getPipeline()), durationSec, stage, inStage);
        long elapsed = job.getStartedAt() == null ? 0 : secondsSince(job.getStartedAt(), now);
        return new Estimate((int) elapsed + remaining, remaining);
    }

    /** 지금 단계 남은 예상 + 다음 단계들의 예상(초). stage가 null이면 아직 시작 전 */
    static int remaining(Map<JobStage, Model> models, int durationSec, JobStage stage, long inStageSec) {
        int from = stage == null ? 0 : STAGES.indexOf(stage);
        double sum = 0;
        for (int i = Math.max(from, 0); i < STAGES.size(); i++) {
            double expected = models.get(STAGES.get(i)).expectedSec(durationSec);
            if (stage != null && i == from) {
                double left = expected - inStageSec;
                expected = left > 0 ? left : Math.max(OVERRUN_MIN_SEC, expected * OVERRUN_LEFT);
            }
            sum += expected;
        }
        return (int) Math.round(sum);
    }

    private Instant stageStartedAt(Job job, JobStage stage) {
        try {
            var stored = progressStore.stageStartedAt(job.getId());
            if (stored.isPresent()) {
                return stored.get();
            }
        } catch (RuntimeException e) {
            log.debug("단계 시작 시각 읽기 실패 jobId={}: {}", job.getId(), e.getMessage());
        }
        // 분석은 작업 시작이 곧 단계 시작, 나머지는 모르면 방금 시작한 것으로 본다
        return stage == JobStage.PREPARE && job.getStartedAt() != null ? job.getStartedAt() : Instant.now();
    }

    private static long secondsSince(Instant from, Instant now) {
        return Math.max(0, Duration.between(from, now).toSeconds());
    }

    /** 경로별 단계 모델. 알림·15초마다 불리므로 1분 동안 다시 쓴다 */
    Map<JobStage, Model> models(Pipeline pipeline) {
        Fitted cached = fitted.get(pipeline);
        if (cached != null && cached.at().plus(FIT_TTL).isAfter(Instant.now())) {
            return cached.models();
        }
        Map<JobStage, Model> models = fitStages(jobRepository.findRecentStageTimes(pipeline.name()), defaults(pipeline));
        fitted.put(pipeline, new Fitted(models, Instant.now()));
        return models;
    }

    static Map<JobStage, Model> defaults(Pipeline pipeline) {
        return pipeline == Pipeline.LOCAL ? LOCAL_DEFAULT : GEMINI_URL_DEFAULT;
    }

    /** 끝난 작업들의 단계 경계 시각으로 단계별 모델. 캐시로 끝난 작업·경계가 빠진 단계는 뺀다 */
    static Map<JobStage, Model> fitStages(List<JobRepository.StageTimes> rows, Map<JobStage, Model> fallback) {
        Map<JobStage, List<Sample>> samples = new EnumMap<>(JobStage.class);
        STAGES.forEach(s -> samples.put(s, new ArrayList<>()));
        for (JobRepository.StageTimes r : rows) {
            Integer d = r.getDurationSec();
            if (d == null || d <= 0 || r.getStartedAt() == null || r.getFinishedAt() == null
                    || r.getFinishedAt() - r.getStartedAt() < MIN_SEC_PER_VIDEO_SEC * d) {
                continue;
            }
            Double[] marks = {r.getStartedAt(), r.getDescribeAt(), r.getMergeAt(), r.getTtsAt(), r.getFinishedAt()};
            for (int i = 0; i < STAGES.size(); i++) {
                if (marks[i] != null && marks[i + 1] != null && marks[i + 1] >= marks[i]) {
                    samples.get(STAGES.get(i)).add(new Sample(d, marks[i + 1] - marks[i]));
                }
            }
        }
        Map<JobStage, Model> out = new EnumMap<>(JobStage.class);
        for (JobStage s : STAGES) {
            out.put(s, fit(samples.get(s), fallback.get(s)));
        }
        return out;
    }

    /** Theil–Sen: 두 작업씩 기울기의 중앙값, 고정 시간은 나머지의 중앙값. 기울기를 못 재면 기본 비율, 기록이 없으면 기본값 */
    static Model fit(List<Sample> samples, Model fallback) {
        if (samples.isEmpty()) {
            return fallback;
        }
        List<Double> slopes = new ArrayList<>();
        for (int i = 0; i < samples.size(); i++) {
            for (int j = i + 1; j < samples.size(); j++) {
                Sample a = samples.get(i);
                Sample b = samples.get(j);
                double gap = b.durationSec() - a.durationSec();
                if (Math.abs(gap) >= MIN_DURATION_GAP_SEC) {
                    slopes.add((b.elapsedSec() - a.elapsedSec()) / gap);
                }
            }
        }
        double slope = slopes.isEmpty() ? fallback.secPerVideoSec() : Math.max(0, median(slopes));
        double fixed = Math.max(0, median(samples.stream().map(s -> s.elapsedSec() - slope * s.durationSec()).toList()));
        return new Model(fixed, slope);
    }

    private static double median(List<Double> values) {
        List<Double> sorted = values.stream().sorted().toList();
        int n = sorted.size();
        return n % 2 == 1 ? sorted.get(n / 2) : (sorted.get(n / 2 - 1) + sorted.get(n / 2)) / 2;
    }
}
