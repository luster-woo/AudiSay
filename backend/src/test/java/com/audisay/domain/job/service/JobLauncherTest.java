package com.audisay.domain.job.service;

import com.audisay.domain.job.entity.JobType;
import com.audisay.domain.job.message.payload.PreparePayload;
import com.audisay.domain.job.repository.JobRepository;
import com.audisay.domain.user.entity.User;
import com.audisay.domain.video.entity.Video;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import org.hibernate.exception.ConstraintViolationException;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;

import java.sql.SQLException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class JobLauncherTest {
    private final JobRepository jobRepository = mock(JobRepository.class);
    private final JobMessagePublisher publisher = mock(JobMessagePublisher.class);
    private final JobLauncher launcher = new JobLauncher(jobRepository, publisher);

    @Test
    void 진행_중_작업_제약에_걸리면_JOB_002() {
        when(jobRepository.saveAndFlush(any())).thenThrow(new DataIntegrityViolationException("could not execute statement",
                hibernate("duplicate key value violates unique constraint \"uq_jobs_active_video\"", "uq_jobs_active_video")));

        assertThatThrownBy(this::launch).isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode()).isEqualTo(ErrorCode.JOB_ALREADY_RUNNING);
        verify(publisher, never()).publish(any(), any(), any());
    }

    @Test
    void 외래_키_같은_다른_제약_위반은_그대로_던진다() {
        DataIntegrityViolationException fk = new DataIntegrityViolationException("could not execute statement",
                hibernate("insert or update on table \"jobs\" violates foreign key constraint \"fk_videos_to_jobs\"",
                        "fk_videos_to_jobs"));
        when(jobRepository.saveAndFlush(any())).thenThrow(fk);

        assertThatThrownBy(this::launch).isSameAs(fk);
        verify(publisher, never()).publish(any(), any(), any());
    }

    @Test
    void 제약_이름이_DB_오류_문구에만_있어도_알아본다() {
        DataIntegrityViolationException active = new DataIntegrityViolationException("could not execute statement",
                new SQLException("ERROR: duplicate key value violates unique constraint \"uq_jobs_active_video\""));
        DataIntegrityViolationException other = new DataIntegrityViolationException("could not execute statement",
                new SQLException("ERROR: null value in column \"video_id\" violates not-null constraint"));

        assertThat(JobLauncher.violates(active, JobLauncher.ACTIVE_JOB_CONSTRAINT)).isTrue();
        assertThat(JobLauncher.violates(other, JobLauncher.ACTIVE_JOB_CONSTRAINT)).isFalse();
    }

    private void launch() {
        launcher.launch(mock(Video.class), mock(User.class), JobType.GENERATE, mock(PreparePayload.class));
    }

    private static ConstraintViolationException hibernate(String sqlMessage, String constraint) {
        return new ConstraintViolationException("could not execute statement", new SQLException(sqlMessage), constraint);
    }
}
