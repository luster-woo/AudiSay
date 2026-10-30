package com.audisay.domain.admin.dto.response;

import com.audisay.domain.report.entity.ReportStatus;

import java.time.Instant;
import java.util.List;

/**
 * @param updatedReportIds 이번에 상태를 바꾼 신고 전부(자기 포함). applyToSameLine이 아니면 자기 하나
 */
public record ReportHandleResponse(Long reportId, ReportStatus status, Instant handledAt, List<Long> updatedReportIds) {
}
