package com.audisay.domain.video.entity;

import com.audisay.domain.user.entity.User;
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
import java.time.LocalDate;

/**
 * 회원이 해설을 요청하거나 영상을 올릴 때마다 한 행. 하루 이용 횟수 = 오늘(KST) counted가 true인 행 수.
 */
@Entity
@Table(name = "generation_requests")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class GenerationRequest {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "video_id", nullable = false)
    private Video video;

    // jobs는 작업 도메인(다른 담당) 테이블이라 연관관계 대신 ID만 둔다
    private Long jobId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 15)
    private GenerationResult result;

    @Column(nullable = false)
    private boolean counted;

    /** 한국 시간(KST) 기준 날짜 */
    @Column(nullable = false)
    private LocalDate requestDate;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant requestedAt;

    /** 새 작업을 만든 요청. 하루 이용 횟수를 차감한다 */
    public static GenerationRequest newJob(User user, Video video, Long jobId, LocalDate requestDate) {
        GenerationRequest request = new GenerationRequest();
        request.user = user;
        request.video = video;
        request.jobId = jobId;
        request.result = GenerationResult.NEW_JOB;
        request.counted = true;
        request.requestDate = requestDate;
        return request;
    }
}
