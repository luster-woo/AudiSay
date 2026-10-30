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
        return of(user, video, jobId, GenerationResult.NEW_JOB, true, requestDate);
    }

    /** 실패한 영상의 작업을 다시 만든 요청. 사용자 책임이 아니라 차감하지 않는다 */
    public static GenerationRequest retry(User user, Video video, Long jobId, LocalDate requestDate) {
        return of(user, video, jobId, GenerationResult.NEW_JOB, false, requestDate);
    }

    /** 다른 회원이 만드는 중인 작업에 합류한 요청 */
    public static GenerationRequest joinedJob(User user, Video video, Long jobId, LocalDate requestDate) {
        return of(user, video, jobId, GenerationResult.JOINED_JOB, false, requestDate);
    }

    /** 완성된 해설을 그대로 쓴 요청 */
    public static GenerationRequest reused(User user, Video video, LocalDate requestDate) {
        return of(user, video, null, GenerationResult.REUSED, false, requestDate);
    }

    /** 사전 확인·이용 제한에 걸린 요청. 영상 행이 있을 때만 남긴다 */
    public static GenerationRequest rejected(User user, Video video, LocalDate requestDate) {
        return of(user, video, null, GenerationResult.REJECTED, false, requestDate);
    }

    private static GenerationRequest of(User user, Video video, Long jobId, GenerationResult result, boolean counted,
                                        LocalDate requestDate) {
        GenerationRequest request = new GenerationRequest();
        request.user = user;
        request.video = video;
        request.jobId = jobId;
        request.result = result;
        request.counted = counted;
        request.requestDate = requestDate;
        return request;
    }
}
