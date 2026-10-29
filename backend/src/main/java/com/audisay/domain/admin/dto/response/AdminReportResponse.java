package com.audisay.domain.admin.dto.response;

import com.audisay.domain.report.entity.ReportReason;
import com.audisay.domain.report.entity.ReportStatus;
import com.audisay.domain.report.repository.AdminReportRow;

import java.time.Instant;

/**
 * @param lineTextSnapshot    신고 당시 문장
 * @param currentText         지금 문장. snapshot과 다르면 이미 고친 신고다
 * @param sameLineReportCount 처리 상태와 관계없이 같은 문장에 들어온 신고 수(자기 포함)
 */
public record AdminReportResponse(
        Long reportId,
        ReportStatus status,
        ReportReason reason,
        String reasonDetail,
        Long videoId,
        String videoTitle,
        Long descriptionId,
        Long lineId,
        Short detailLevel,
        Integer lineStartMs,
        Integer reportedAtMs,
        String lineTextSnapshot,
        String currentText,
        Long sameLineReportCount,
        Long reporterId,
        Instant createdAt,
        Instant handledAt
) {
    public static AdminReportResponse from(AdminReportRow row) {
        return new AdminReportResponse(
                row.reportId(),
                row.status(),
                row.reason(),
                row.reasonDetail(),
                row.videoId(),
                row.videoTitle(),
                row.descriptionId(),
                row.lineId(),
                row.detailLevel(),
                row.lineStartMs(),
                row.reportedAtMs(),
                row.lineTextSnapshot(),
                row.currentText(),
                row.sameLineReportCount(),
                row.reporterId(),
                row.createdAt(),
                row.handledAt()
        );
    }
}
