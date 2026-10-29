package com.audisay.domain.report.dto.response;

import com.audisay.domain.report.entity.Report;
import com.audisay.domain.report.entity.ReportStatus;

public record ReportCreateResponse(Long reportId, ReportStatus status) {
    public static ReportCreateResponse from(Report report) {
        return new ReportCreateResponse(report.getId(), report.getStatus());
    }
}
