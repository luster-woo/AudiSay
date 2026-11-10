package com.audisay.domain.job.stream;

import com.audisay.domain.job.dto.response.JobStatusResponse;
import com.audisay.domain.job.entity.JobStage;
import com.audisay.domain.job.entity.JobStatus;
import com.audisay.domain.job.entity.JobType;
import com.audisay.domain.job.service.JobQueryService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class JobStreamFinisherTest {
    private final JobSseEmitters emitters = mock(JobSseEmitters.class);
    private final JobQueryService jobQueryService = mock(JobQueryService.class);
    private final JobStreamFinisher finisher = new JobStreamFinisher(emitters, jobQueryService);

    @Test
    void 구독자가_없으면_DB를_보지_않는다() {
        when(emitters.jobIds()).thenReturn(Set.of());

        finisher.finishMissed();

        verifyNoInteractions(jobQueryService);
    }

    @Test
    void 끝_알림을_놓친_작업은_최종_상태를_보낸다() {
        when(emitters.jobIds()).thenReturn(Set.of(1L, 2L));
        when(jobQueryService.findFinished(Set.of(1L, 2L))).thenReturn(List.of(new JobStatusResponse(1L, 10L,
                JobType.GENERATE, JobStatus.SUCCEEDED, JobStage.MERGE, 100, null, null, 7L, null, null, false,
                null, null, null, null)));

        finisher.finishMissed();

        ArgumentCaptor<JobStreamEvent> event = ArgumentCaptor.forClass(JobStreamEvent.class);
        verify(emitters).send(eq(1L), event.capture());
        assertThat(event.getValue().name()).isEqualTo(JobStreamEvent.COMPLETED);
        verify(emitters, never()).send(eq(2L), any());
    }

    @Test
    void DB를_못_읽어도_예외를_던지지_않는다() {
        when(emitters.jobIds()).thenReturn(Set.of(1L));
        when(jobQueryService.findFinished(any())).thenThrow(new IllegalStateException("db down"));

        finisher.finishMissed();

        verify(emitters, never()).send(anyLong(), any());
    }
}
