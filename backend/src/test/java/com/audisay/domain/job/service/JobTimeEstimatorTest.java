package com.audisay.domain.job.service;

import com.audisay.domain.job.entity.Pipeline;
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
        assertThat(JobTimeEstimator.remaining(200, 400, 36)).isCloseTo(JobTimeEstimator.remaining(200, 400, 34), org.assertj.core.data.Offset.offset(10));
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
    void 너무_빨리_끝난_기록만_있으면_기본_비율() {
        assertThat(JobTimeEstimator.medianRatio(List.of(0.02, 0.03, 0.03), Pipeline.GEMINI_URL))
                .isEqualTo(JobTimeEstimator.GEMINI_URL_SEC_PER_VIDEO_SEC);
        assertThat(JobTimeEstimator.medianRatio(List.of(), Pipeline.LOCAL))
                .isEqualTo(JobTimeEstimator.LOCAL_SEC_PER_VIDEO_SEC);
    }

    @Test
    void 너무_빨리_끝난_기록은_빼고_중앙값() {
        assertThat(JobTimeEstimator.medianRatio(List.of(0.03, 0.4, 0.5, 0.6), Pipeline.GEMINI_URL)).isEqualTo(0.5);
    }

    @Test
    void 배포_24번_작업_흐름() {
        // 33초 영상, 기본 비율로 예상 15초. 실제로는 27초 걸림(준비 단계 21초)
        int expected = (int) Math.round(33 * JobTimeEstimator.GEMINI_URL_SEC_PER_VIDEO_SEC);
        assertThat(JobTimeEstimator.remaining(1, expected, 0)).isEqualTo(14);
        assertThat(JobTimeEstimator.remaining(9, expected, 5)).isEqualTo(6);
        assertThat(JobTimeEstimator.remaining(21, expected, 20)).isNull();
        assertThat(JobTimeEstimator.remaining(22, expected, 70)).isEqualTo(9);
        assertThat(JobTimeEstimator.remaining(25, expected, 90)).isEqualTo(3);
    }
}
