package com.audisay.domain.job.service;

import com.audisay.domain.description.service.DescriptionService;
import com.audisay.domain.job.dto.JobProgress;
import com.audisay.domain.job.entity.Job;
import com.audisay.domain.job.entity.JobStage;
import com.audisay.domain.job.entity.JobStatus;
import com.audisay.domain.job.entity.JobType;
import com.audisay.domain.job.entity.Pipeline;
import com.audisay.domain.job.repository.JobChunkRepository;
import com.audisay.domain.job.repository.JobRepository;
import com.audisay.domain.upload.service.UploadService;
import com.audisay.domain.user.entity.User;
import com.audisay.domain.video.entity.Video;
import com.audisay.global.config.JobProperties;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import tools.jackson.databind.json.JsonMapper;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class JobEventServiceStaleTest {
    private static final Long JOB_ID = 7L;
    private static final Instant NOW = Instant.parse("2026-11-04T12:00:00Z");
    private static final Instant QUEUED_BEFORE = NOW.minus(Duration.ofHours(2));
    private static final Instant RUNNING_BEFORE = NOW.minus(Duration.ofMinutes(45));

    private JobRepository jobRepository;
    private JobChunkRepository jobChunkRepository;
    private JobProgressNotifier notifier;
    private JobProgressStore progressStore;
    private UploadService uploadService;
    private SimpleMeterRegistry meterRegistry;
    private JobEventService service;

    @BeforeEach
    void setUp() {
        jobRepository = mock(JobRepository.class);
        jobChunkRepository = mock(JobChunkRepository.class);
        notifier = mock(JobProgressNotifier.class);
        progressStore = mock(JobProgressStore.class);
        uploadService = mock(UploadService.class);
        meterRegistry = new SimpleMeterRegistry();
        service = new JobEventService(jobRepository, jobChunkRepository, mock(JobMessagePublisher.class), notifier,
                progressStore, mock(JobEventDeduplicator.class), mock(DescriptionService.class), uploadService,
                new JobProperties(true, new JobProperties.Stale(true, Duration.ofHours(2), Duration.ofMinutes(45))),
                JsonMapper.builder().build(), meterRegistry);
        when(progressStore.find(JOB_ID)).thenReturn(Optional.empty());
    }

    @Test
    void 진행_중인데_45분_넘게_소식이_없으면_FAILED() {
        Job job = running(Pipeline.GEMINI_URL, NOW.minus(Duration.ofHours(2)));

        assertThat(service.failIfStale(JOB_ID, QUEUED_BEFORE, RUNNING_BEFORE)).isTrue();

        assertThat(job.getStatus()).isEqualTo(JobStatus.FAILED);
        assertThat(job.getErrorCode()).isEqualTo("AI_TIMEOUT");
        assertThat(job.isRetryable()).isTrue();
        verify(notifier).failed(job);
        verify(uploadService, never()).failTranscode(any());
        assertThat(meterRegistry.counter("audisay.job.stale", "status", "RUNNING", "stage", "DESCRIBE").count())
                .isEqualTo(1);
    }

    @Test
    void Redis_진행_상태가_최근이면_건너뛴다() {
        Job job = running(Pipeline.GEMINI_URL, NOW.minus(Duration.ofHours(2)));
        when(progressStore.find(JOB_ID)).thenReturn(Optional.of(
                new JobProgress(JobStatus.RUNNING, JobStage.DESCRIBE, 40, NOW.minus(Duration.ofMinutes(10)))));

        assertThat(service.failIfStale(JOB_ID, QUEUED_BEFORE, RUNNING_BEFORE)).isFalse();
        assertThat(job.getStatus()).isEqualTo(JobStatus.RUNNING);
        verify(notifier, never()).failed(any());
    }

    @Test
    void 조각이_최근에_갱신됐으면_건너뛴다() {
        Job job = running(Pipeline.GEMINI_URL, NOW.minus(Duration.ofHours(2)));
        when(jobChunkRepository.findLastUpdatedAt(JOB_ID)).thenReturn(NOW.minus(Duration.ofMinutes(5)));

        assertThat(service.failIfStale(JOB_ID, QUEUED_BEFORE, RUNNING_BEFORE)).isFalse();
        assertThat(job.getStatus()).isEqualTo(JobStatus.RUNNING);
    }

    @Test
    void 아직_안_끝난_조각이_있으면_워커_대기로_보고_2시간까지_기다린다() {
        Job job = running(Pipeline.GEMINI_URL, NOW.minus(Duration.ofHours(1)));
        when(jobChunkRepository.existsByJob_IdAndStatus(JOB_ID, com.audisay.domain.job.entity.JobChunkStatus.PENDING))
                .thenReturn(true);

        assertThat(service.failIfStale(JOB_ID, QUEUED_BEFORE, RUNNING_BEFORE)).isFalse();
        assertThat(job.getStatus()).isEqualTo(JobStatus.RUNNING);
    }

    @Test
    void 업로드_영상_분석_중이면_2시간까지_기다린다() {
        Job job = running(Pipeline.LOCAL, NOW.minus(Duration.ofHours(1)));
        ReflectionTestUtils.setField(job, "currentStage", JobStage.PREPARE);

        assertThat(service.failIfStale(JOB_ID, QUEUED_BEFORE, RUNNING_BEFORE)).isFalse();
        assertThat(job.getStatus()).isEqualTo(JobStatus.RUNNING);
    }

    @Test
    void 대기_중은_2시간까지_기다린다() {
        Job job = queued(NOW.minus(Duration.ofHours(1)));

        assertThat(service.failIfStale(JOB_ID, QUEUED_BEFORE, RUNNING_BEFORE)).isFalse();
        assertThat(job.getStatus()).isEqualTo(JobStatus.QUEUED);
    }

    @Test
    void 대기_중_2시간이_넘으면_FAILED() {
        Job job = queued(NOW.minus(Duration.ofHours(3)));

        assertThat(service.failIfStale(JOB_ID, QUEUED_BEFORE, RUNNING_BEFORE)).isTrue();
        assertThat(job.getStatus()).isEqualTo(JobStatus.FAILED);
        assertThat(meterRegistry.counter("audisay.job.stale", "status", "QUEUED", "stage", "NONE").count())
                .isEqualTo(1);
    }

    @Test
    void 업로드_영상이면_변환도_실패로_바꾼다() {
        running(Pipeline.LOCAL, NOW.minus(Duration.ofHours(2)));

        assertThat(service.failIfStale(JOB_ID, QUEUED_BEFORE, RUNNING_BEFORE)).isTrue();
        verify(uploadService).failTranscode(1L);
    }

    @Test
    void 잠근_사이에_끝났으면_건너뛴다() {
        Job job = running(Pipeline.GEMINI_URL, NOW.minus(Duration.ofHours(2)));
        job.complete(false);

        assertThat(service.failIfStale(JOB_ID, QUEUED_BEFORE, RUNNING_BEFORE)).isFalse();
        assertThat(job.getStatus()).isEqualTo(JobStatus.SUCCEEDED);
        verify(notifier, never()).failed(any());
    }

    @Test
    void Redis를_못_읽으면_예외로_이번_주기는_건너뛴다() {
        Job job = running(Pipeline.GEMINI_URL, NOW.minus(Duration.ofHours(2)));
        when(progressStore.find(JOB_ID)).thenThrow(new IllegalStateException("redis down"));

        assertThatThrownBy(() -> service.failIfStale(JOB_ID, QUEUED_BEFORE, RUNNING_BEFORE))
                .isInstanceOf(IllegalStateException.class);
        assertThat(job.getStatus()).isEqualTo(JobStatus.RUNNING);
    }

    private Job queued(Instant queuedAt) {
        Job job = job(Pipeline.GEMINI_URL);
        ReflectionTestUtils.setField(job, "queuedAt", queuedAt);
        return job;
    }

    private Job running(Pipeline pipeline, Instant startedAt) {
        Job job = job(pipeline);
        ReflectionTestUtils.setField(job, "queuedAt", startedAt.minus(Duration.ofMinutes(1)));
        ReflectionTestUtils.setField(job, "status", JobStatus.RUNNING);
        ReflectionTestUtils.setField(job, "currentStage", JobStage.DESCRIBE);
        ReflectionTestUtils.setField(job, "startedAt", startedAt);
        return job;
    }

    private Job job(Pipeline pipeline) {
        Video video = mock(Video.class);
        when(video.getId()).thenReturn(1L);
        Job job = Job.create(video, mock(User.class), JobType.GENERATE, pipeline);
        ReflectionTestUtils.setField(job, "id", JOB_ID);
        when(jobRepository.findByIdForUpdate(JOB_ID)).thenReturn(Optional.of(job));
        return job;
    }
}
