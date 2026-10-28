package com.audisay.domain.job.entity;

import com.audisay.domain.user.entity.User;
import com.audisay.domain.video.entity.Video;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;

/**
 * 해설 생성 작업. 한 영상에 진행 중(QUEUED·RUNNING)인 작업은 하나뿐이다(uq_jobs_active_video).
 */
@Entity
@Table(name = "jobs")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Job {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "video_id", nullable = false)
    private Video video;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "requested_by", nullable = false)
    private User requestedBy;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 15)
    private JobType jobType = JobType.GENERATE;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 15)
    private Pipeline pipeline;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 15)
    private JobStatus status = JobStatus.QUEUED;

    @Enumerated(EnumType.STRING)
    @Column(length = 15)
    private JobStage currentStage;

    /** 0~100, 워커가 보고한 값 */
    @Column(nullable = false)
    private Short progress = 0;

    /** 실패 원인(AI_LIMIT, AI_TIMEOUT 등). HTTP ErrorCode와 별개다 */
    @Column(length = 50)
    private String errorCode;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant queuedAt;

    private Instant startedAt;

    private Instant finishedAt;
}
