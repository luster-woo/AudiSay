package com.audisay.domain.job.entity;

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
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;

@Entity
@Table(name = "job_chunks")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class JobChunk {
    private static final int MAX_ERROR_LENGTH = 1000;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "job_id", nullable = false)
    private Job job;

    @Column(nullable = false)
    private Integer chunkIndex;

    @Column(nullable = false)
    private Integer startMs;

    @Column(nullable = false)
    private Integer endMs;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private JobChunkStatus status = JobChunkStatus.PENDING;

    @Column(nullable = false)
    private Short attempts = 0;

    private String contextSummary;

    private String lastError;

    @Column(length = 100)
    private String workerId;

    private Instant startedAt;

    private Instant finishedAt;

    @UpdateTimestamp
    @Column(nullable = false)
    private Instant updatedAt = Instant.now();

    public static JobChunk create(Job job, int chunkIndex, int startMs, int endMs, String contextSummary) {
        JobChunk chunk = new JobChunk();
        chunk.job = job;
        chunk.chunkIndex = chunkIndex;
        chunk.startMs = startMs;
        chunk.endMs = endMs;
        chunk.contextSummary = contextSummary;
        return chunk;
    }

    public void succeed(int attempt, String workerId) {
        if (status.isFinished()) {
            return;
        }
        status = JobChunkStatus.SUCCEEDED;
        recordAttempt(attempt);
        this.workerId = workerId;
        finishedAt = Instant.now();
    }

    public void fail(int attempt, String workerId, String errorCode, String errorDetail) {
        if (status.isFinished()) {
            return;
        }
        status = JobChunkStatus.FAILED;
        recordAttempt(attempt);
        this.workerId = workerId;
        lastError = truncate(errorText(errorCode, errorDetail));
        finishedAt = Instant.now();
    }

    /** 워커가 3번 시도해도 실패해 DLQ로 간 조각 */
    public void markDead(int attempt, String errorCode, String errorDetail) {
        if (status.isFinished()) {
            return;
        }
        status = JobChunkStatus.DEAD;
        recordAttempt(attempt);
        lastError = truncate(errorText(errorCode, errorDetail));
        finishedAt = Instant.now();
    }

    /** 워커가 코드를 빠뜨리면 "null: ..."이 아니라 UNKNOWN으로 */
    private static String errorText(String errorCode, String errorDetail) {
        return (errorCode == null || errorCode.isBlank() ? "UNKNOWN" : errorCode) + ": " + errorDetail;
    }

    /** last_error는 "코드: 내용" 형식으로 저장한다 */
    public String getErrorCode() {
        if (lastError == null) {
            return null;
        }
        int end = lastError.indexOf(':');
        return end < 0 ? lastError : lastError.substring(0, end);
    }

    private void recordAttempt(int attempt) {
        attempts = (short) Math.clamp(attempt, 0, 3);
    }

    private static String truncate(String error) {
        return error == null || error.length() <= MAX_ERROR_LENGTH ? error : error.substring(0, MAX_ERROR_LENGTH);
    }
}
