package com.audisay.domain.job.service;

import com.audisay.domain.job.entity.JobStage;
import com.audisay.domain.job.entity.Pipeline;
import com.audisay.domain.job.repository.JobRepository;
import org.assertj.core.data.Offset;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static com.audisay.domain.job.service.JobTimeEstimator.GEMINI_URL_DEFAULT;
import static org.assertj.core.api.Assertions.assertThat;

class JobTimeEstimatorTest {

    @Test
    void 시작_전이면_모든_단계의_합() {
        // 10분 2초 영상: 분석 42 + 7.2, 조각 0.5, 합치기 0.5, 음성 13 + 3.0 = 66.2 (11-06 실측 68초)
        assertThat(JobTimeEstimator.remaining(GEMINI_URL_DEFAULT, 602, null, 0)).isEqualTo(66);
    }

    @Test
    void 지금_단계는_지난_시간을_빼고_다음_단계를_더한다() {
        // 분석 예상 49.2초 중 30초 지남 → 19.2 + 0.5 + 0.5 + 16.0 = 36.2
        assertThat(JobTimeEstimator.remaining(GEMINI_URL_DEFAULT, 602, JobStage.PREPARE, 30)).isEqualTo(36);
        // 음성만 남음: 16.0 − 5 = 11
        assertThat(JobTimeEstimator.remaining(GEMINI_URL_DEFAULT, 602, JobStage.TTS, 5)).isEqualTo(11);
    }

    @Test
    void 지금_단계가_예상을_넘기면_거의_끝으로_보고_남은_단계만() {
        // 분석 예상 49.2초를 넘김 → 분석 4.9(10%) + 0.5 + 0.5 + 16.0 = 21.9, null 이나 0이 아님
        assertThat(JobTimeEstimator.remaining(GEMINI_URL_DEFAULT, 602, JobStage.PREPARE, 120)).isEqualTo(22);
        // 마지막 단계에서 넘기면 최소 3초
        assertThat(JobTimeEstimator.remaining(GEMINI_URL_DEFAULT, 602, JobStage.TTS, 100)).isEqualTo(3);
    }

    @Test
    void 기본값은_11월_6일_실측과_가깝다() {
        // 1분 56초 58초, 5분 13초 60초, 10분 2초 68초 (대기·단계 넘김 1초 안팎 제외)
        assertThat(JobTimeEstimator.remaining(GEMINI_URL_DEFAULT, 116, null, 0)).isCloseTo(57, Offset.offset(3));
        assertThat(JobTimeEstimator.remaining(GEMINI_URL_DEFAULT, 313, null, 0)).isCloseTo(60, Offset.offset(3));
        assertThat(JobTimeEstimator.remaining(GEMINI_URL_DEFAULT, 602, null, 0)).isCloseTo(68, Offset.offset(3));
    }

    @Test
    void 끝난_작업의_단계_경계로_단계마다_맞춘다() {
        // 11-06 실측 세 작업(단계 경계 epoch 초): 분석 43.9·40.5·50.3, 음성 13.1·18.3·16.3
        List<JobRepository.StageTimes> rows = List.of(
                times(116, 0, 43.9, 44.1, 44.4, 57.5),
                times(313, 0, 40.5, 40.9, 41.3, 59.6),
                times(602, 0, 50.3, 50.9, 51.5, 67.8));
        Map<JobStage, JobTimeEstimator.Model> m = JobTimeEstimator.fitStages(rows, GEMINI_URL_DEFAULT);
        assertThat(m.get(JobStage.PREPARE).expectedSec(602)).isCloseTo(50.3, Offset.offset(3.0));
        assertThat(m.get(JobStage.DESCRIBE).expectedSec(602)).isCloseTo(0.6, Offset.offset(0.3));
        assertThat(JobTimeEstimator.remaining(m, 602, null, 0)).isCloseTo(68, Offset.offset(4));
    }

    @Test
    void 캐시로_끝난_작업과_경계가_빠진_단계는_빼고_없으면_기본값() {
        List<JobRepository.StageTimes> rows = List.of(
                times(300, 0, 2.0, 2.2, 2.4, 5),            // 300초 영상이 5초 → 캐시, 뺌
                times(200, 0, null, null, null, 60));     // 단계 경계 없음 → 단계별 표본 없음
        Map<JobStage, JobTimeEstimator.Model> m = JobTimeEstimator.fitStages(rows, GEMINI_URL_DEFAULT);
        assertThat(m).isEqualTo(GEMINI_URL_DEFAULT);
        assertThat(JobTimeEstimator.defaults(Pipeline.LOCAL)).isEqualTo(JobTimeEstimator.LOCAL_DEFAULT);
    }

    @Test
    void 튀는_기록이_있어도_중앙값으로_맞춘다() {
        List<JobTimeEstimator.Sample> samples = List.of(
                sample(60, 29), sample(120, 33), sample(300, 46), sample(600, 67), sample(100, 400));
        JobTimeEstimator.Model m = JobTimeEstimator.fit(samples, GEMINI_URL_DEFAULT.get(JobStage.PREPARE));
        assertThat(m.expectedSec(300)).isBetween(40.0, 60.0);
    }

    @Test
    void 길이가_비슷한_기록뿐이면_기본_비율로_고정_시간만() {
        JobTimeEstimator.Model m = JobTimeEstimator.fit(List.of(sample(300, 50), sample(310, 52)),
                new JobTimeEstimator.Model(10, 0.07));
        assertThat(m.secPerVideoSec()).isEqualTo(0.07);
        assertThat(m.fixedSec()).isCloseTo(29.7, Offset.offset(0.5));
    }

    @Test
    void 기울기가_음수로_나오면_0으로() {
        JobTimeEstimator.Model m = JobTimeEstimator.fit(List.of(sample(60, 50), sample(600, 40)),
                new JobTimeEstimator.Model(10, 0.07));
        assertThat(m.secPerVideoSec()).isZero();
        assertThat(m.fixedSec()).isEqualTo(45.0);
    }

    private static JobTimeEstimator.Sample sample(double durationSec, double elapsedSec) {
        return new JobTimeEstimator.Sample(durationSec, elapsedSec);
    }

    private static JobRepository.StageTimes times(int duration, double started, Double describe, Double merge,
                                                  Double tts, double finished) {
        return new JobRepository.StageTimes() {
            public Integer getDurationSec() {
                return duration;
            }

            public Double getStartedAt() {
                return started;
            }

            public Double getDescribeAt() {
                return describe;
            }

            public Double getMergeAt() {
                return merge;
            }

            public Double getTtsAt() {
                return tts;
            }

            public Double getFinishedAt() {
                return finished;
            }
        };
    }
}
