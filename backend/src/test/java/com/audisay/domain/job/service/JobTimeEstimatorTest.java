package com.audisay.domain.job.service;

import org.junit.jupiter.api.Test;

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
        assertThat(JobTimeEstimator.remaining(200, 400, 36)).isCloseTo(JobTimeEstimator.remaining(200, 400, 34), org.assertj.core.data.Offset.offset(10));
    }

    @Test
    void 예상을_넘겨도_음수가_되지_않는다() {
        assertThat(JobTimeEstimator.remaining(500, 400, 10)).isZero();
    }
}
