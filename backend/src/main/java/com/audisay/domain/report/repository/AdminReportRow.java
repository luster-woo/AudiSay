package com.audisay.domain.report.repository;

import com.audisay.domain.report.entity.ReportReason;
import com.audisay.domain.report.entity.ReportStatus;

import java.time.Instant;

/**
 * 관리자 신고 목록의 한 줄: 신고와 그 문장·해설·영상.
 *
 * @param lineTextSnapshot    신고 당시 문장
 * @param currentText         지금 문장. snapshot과 다르면 이미 고친 신고다
 * @param sameLineReportCount 처리 상태와 관계없이 같은 문장에 들어온 신고 수(자기 포함)
 */
public record AdminReportRow(
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
}
