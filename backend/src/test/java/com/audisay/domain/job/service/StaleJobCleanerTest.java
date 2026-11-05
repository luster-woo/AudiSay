package com.audisay.domain.job.service;

import com.audisay.domain.job.entity.JobStatus;
import com.audisay.domain.job.repository.JobRepository;
import com.audisay.global.config.JobProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Pageable;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class StaleJobCleanerTest {
    private static final Instant NOW = Instant.parse("2026-11-04T12:00:00Z");
    private static final Instant QUEUED_BEFORE = Instant.parse("2026-11-04T10:00:00Z");
    private static final Instant RUNNING_BEFORE = Instant.parse("2026-11-04T11:15:00Z");

    private JobRepository jobRepository;
    private JobEventService jobEventService;

    @BeforeEach
    void setUp() {
        jobRepository = mock(JobRepository.class);
        jobEventService = mock(JobEventService.class);
    }

    @Test
    void 기준_시각으로_후보를_찾아_하나씩_정리하고_실패한_작업은_건너뛴다() {
        when(jobRepository.findStaleCandidateIds(eq(JobStatus.QUEUED), eq(QUEUED_BEFORE),
                eq(JobStatus.RUNNING), eq(RUNNING_BEFORE), eq(0L), any(Pageable.class))).thenReturn(List.of(1L, 2L, 3L));
        when(jobEventService.failIfStale(1L, QUEUED_BEFORE, RUNNING_BEFORE)).thenReturn(true);
        when(jobEventService.failIfStale(2L, QUEUED_BEFORE, RUNNING_BEFORE)).thenThrow(new IllegalStateException("redis down"));
        when(jobEventService.failIfStale(3L, QUEUED_BEFORE, RUNNING_BEFORE)).thenReturn(false);

        assertThat(cleaner(true).cleanUp(NOW)).isEqualTo(1);
        verify(jobEventService).failIfStale(3L, QUEUED_BEFORE, RUNNING_BEFORE);
    }

    @Test
    void 꺼져_있으면_아무것도_하지_않는다() {
        cleaner(false).cleanUp();

        verify(jobRepository, never()).findStaleCandidateIds(any(), any(), any(), any(), any(), any());
        verify(jobEventService, never()).failIfStale(anyLong(), any(), any());
    }

    private StaleJobCleaner cleaner(boolean enabled) {
        JobProperties properties = new JobProperties(true,
                new JobProperties.Stale(enabled, Duration.ofHours(2), Duration.ofMinutes(45)));
        return new StaleJobCleaner(jobRepository, jobEventService, properties);
    }
}
