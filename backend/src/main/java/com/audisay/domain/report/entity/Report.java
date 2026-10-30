package com.audisay.domain.report.entity;

import com.audisay.domain.description.entity.DescriptionLine;
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
 * 해설 문장 신고. 같은 회원은 같은 문장을 한 번만 신고한다(uq_reports_user_line).
 */
@Entity
@Table(name = "reports")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Report {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "line_id", nullable = false)
    private DescriptionLine line;

    @Column(nullable = false)
    private Long userId;

    /** 신고 키를 누른 순간의 영상 시각 */
    @Column(nullable = false)
    private Integer reportedAtMs;

    /** 신고 당시 문장. 나중에 문장을 고쳐도 무엇을 신고했는지 남는다 */
    @Column(nullable = false)
    private String lineTextSnapshot;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private ReportReason reason;

    @Column(length = 500)
    private String reasonDetail;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private ReportStatus status = ReportStatus.PENDING;

    private Instant handledAt;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    public static Report create(DescriptionLine line, Long userId, Integer reportedAtMs,
                                ReportReason reason, String reasonDetail) {
        Report report = new Report();
        report.line = line;
        report.userId = userId;
        report.reportedAtMs = reportedAtMs;
        report.lineTextSnapshot = line.getText();
        report.reason = reason;
        report.reasonDetail = (reasonDetail == null || reasonDetail.isBlank()) ? null : reasonDetail.strip();
        return report;
    }

    public boolean isPending() {
        return status == ReportStatus.PENDING;
    }

    /** 처리 완료(RESOLVED) 또는 반려(REJECTED) */
    public void handle(ReportStatus status, Instant now) {
        this.status = status;
        this.handledAt = now;
    }
}
