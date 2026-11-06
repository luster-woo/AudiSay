package com.audisay.domain.job.service;

import org.assertj.core.data.Offset;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class JobTimeEstimatorTest {

    @Test
    void 처음에는_예상에서_지난_시간을_뺀다() {
        // 예상 400초, 60초 지남, 20%(실제 속도로는 240초) → 35% 전이라 예상만
        assertThat(JobTimeEstimator.remaining(60, 400, 20)).isEqualTo(340);
    }

    @Test
    void 진행률_85퍼센트부터는_실제_진행_속도로() {
        // 300초에 90% → 실제 속도로 남은 33초(예상 400초는 무시)
        assertThat(JobTimeEstimator.remaining(300, 400, 90)).isEqualTo(33);
    }

    @Test
    void 그_사이는_섞어서_툭_튀지_않는다() {
        // 60% → 절반씩: 예상 남은 200초, 실제 속도로 남은 133초
        int mid = JobTimeEstimator.remaining(200, 400, 60);
        assertThat(mid).isBetween(133, 200);
        assertThat(JobTimeEstimator.remaining(200, 400, 36)).isCloseTo(JobTimeEstimator.remaining(200, 400, 34), Offset.offset(10));
    }

    @Test
    void 진행률_35퍼센트_전에_예상을_넘기면_모른다() {
        assertThat(JobTimeEstimator.remaining(500, 400, 10)).isNull();
    }

    @Test
    void 진행률_35퍼센트_뒤에_예상을_넘기면_실제_진행_속도로() {
        assertThat(JobTimeEstimator.remaining(500, 400, 50)).isEqualTo(500);
    }

    @Test
    void 기록이_없거나_너무_빨리_끝난_기록만_있으면_기본값() {
        assertThat(JobTimeEstimator.fit(List.of(), JobTimeEstimator.LOCAL_DEFAULT)).isEqualTo(JobTimeEstimator.LOCAL_DEFAULT);
        List<JobTimeEstimator.Sample> cached = List.of(sample(300, 9), sample(200, 5));
        assertThat(JobTimeEstimator.fit(cached, JobTimeEstimator.GEMINI_URL_DEFAULT)).isEqualTo(JobTimeEstimator.GEMINI_URL_DEFAULT);
    }

    @Test
    void 배포_기록_두_개면_고정_시간과_비율을_맞춘다() {
        // 33초 영상 27초, 347초 영상 48초 → 약 25초 + 0.067배
        JobTimeEstimator.Model m = JobTimeEstimator.fit(List.of(sample(33, 27), sample(347, 48)), JobTimeEstimator.GEMINI_URL_DEFAULT);
        assertThat(m.secPerVideoSec()).isCloseTo(0.067, Offset.offset(0.001));
        assertThat(m.fixedSec()).isCloseTo(24.8, Offset.offset(0.5));
        assertThat(m.expectedSec(347)).isCloseTo(48, Offset.offset(1));
        assertThat(m.expectedSec(33)).isCloseTo(27, Offset.offset(1));
    }

    @Test
    void 롯데_하이라이트_예전_방식은_2분_36초() {
        // 예전: 0.45배 × 347초 = 156초(2분 36초), 실제 48초. 기본값만으로도 49초
        assertThat((int) Math.round(347 * 0.45)).isEqualTo(156);
        assertThat(JobTimeEstimator.GEMINI_URL_DEFAULT.expectedSec(347)).isEqualTo(49);
    }

    @Test
    void 캐시_기록과_튀는_기록은_결과를_흔들지_않는다() {
        List<JobTimeEstimator.Sample> samples = List.of(
                sample(60, 29), sample(120, 33), sample(300, 46), sample(600, 67),
                sample(400, 8),     // 캐시로 끝난 작업 — 뺌
                sample(100, 400));  // 한 번 크게 밀린 작업
        JobTimeEstimator.Model m = JobTimeEstimator.fit(samples, JobTimeEstimator.GEMINI_URL_DEFAULT);
        assertThat(m.expectedSec(300)).isBetween(40, 60);
    }

    @Test
    void 길이가_비슷한_기록뿐이면_기본_비율로_고정_시간만() {
        JobTimeEstimator.Model m = JobTimeEstimator.fit(List.of(sample(300, 50), sample(310, 52)), JobTimeEstimator.GEMINI_URL_DEFAULT);
        assertThat(m.secPerVideoSec()).isEqualTo(0.07);
        assertThat(m.fixedSec()).isCloseTo(29.7, Offset.offset(0.5));
    }

    @Test
    void 기울기가_음수로_나오면_0으로() {
        JobTimeEstimator.Model m = JobTimeEstimator.fit(List.of(sample(60, 50), sample(600, 40)), JobTimeEstimator.GEMINI_URL_DEFAULT);
        assertThat(m.secPerVideoSec()).isZero();
        assertThat(m.fixedSec()).isEqualTo(45.0);
    }

    @Test
    void 배포_24번_작업_흐름() {
        // 33초 영상, 기본값으로 예상 27초. 실제로도 27초 걸림(준비 단계 21초)
        int expected = JobTimeEstimator.GEMINI_URL_DEFAULT.expectedSec(33);
        assertThat(expected).isEqualTo(27);
        assertThat(JobTimeEstimator.remaining(1, expected, 0)).isEqualTo(26);
        assertThat(JobTimeEstimator.remaining(21, expected, 20)).isEqualTo(6);
        assertThat(JobTimeEstimator.remaining(25, expected, 90)).isBetween(2, 3);
    }

    private static JobTimeEstimator.Sample sample(double durationSec, double elapsedSec) {
        return new JobTimeEstimator.Sample(durationSec, elapsedSec);
    }
}
