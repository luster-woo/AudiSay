package com.audisay.domain.video.service;

import com.audisay.domain.description.repository.DescriptionRepository;
import com.audisay.domain.job.entity.Job;
import com.audisay.domain.job.entity.JobType;
import com.audisay.domain.job.entity.Pipeline;
import com.audisay.domain.job.repository.JobRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class DescriptionStateReaderTest {
    private JobRepository jobRepository;
    private DescriptionStateReader reader;

    @BeforeEach
    void setUp() {
        jobRepository = mock(JobRepository.class);
        reader = new DescriptionStateReader(mock(DescriptionRepository.class), jobRepository);
    }

    @Test
    void 다시_해도_같은_이유로_실패할_오류면_다시_할_수_없다() {
        latest("TRANSCODE_FAILED");

        assertThat(reader.latestFailureNotRetryable(1L, false)).isTrue();
        assertThat(reader.latestFailureNotRetryable(1L, true)).isTrue();
    }

    @Test
    void 일시적인_오류면_다시_할_수_있다() {
        latest("AI_TIMEOUT");

        assertThat(reader.latestFailureNotRetryable(1L, false)).isFalse();
    }

    @Test
    void 볼_수_없던_영상은_방금_다시_확인해_볼_수_있으면_다시_할_수_있다() {
        latest("VIDEO_UNAVAILABLE");

        assertThat(reader.latestFailureNotRetryable(1L, false)).isTrue();
        assertThat(reader.latestFailureNotRetryable(1L, true)).isFalse();
    }

    @Test
    void 작업이_없으면_막지_않는다() {
        when(jobRepository.findLatestByVideoIds(List.of(1L))).thenReturn(List.of());

        assertThat(reader.latestFailureNotRetryable(1L, false)).isFalse();
    }

    private void latest(String errorCode) {
        Job job = Job.create(null, null, JobType.GENERATE, Pipeline.LOCAL);
        job.fail(errorCode);
        when(jobRepository.findLatestByVideoIds(List.of(1L))).thenReturn(List.of(job));
    }
}
