package com.audisay.domain.admin.service;

import com.audisay.domain.admin.dto.request.ReportHandleRequest;
import com.audisay.domain.admin.dto.response.AdminReportResponse;
import com.audisay.domain.admin.dto.response.ReportHandleResponse;
import com.audisay.domain.report.entity.Report;
import com.audisay.domain.report.entity.ReportReason;
import com.audisay.domain.report.entity.ReportStatus;
import com.audisay.domain.report.repository.ReportRepository;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import com.audisay.global.response.PageResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@Service
@RequiredArgsConstructor
public class AdminReportService {
    private final ReportRepository reportRepository;

    /**
     * status가 없으면 처리할 신고(PENDING)를 준다.
     */
    @Transactional(readOnly = true)
    public PageResponse<AdminReportResponse> getReports(ReportStatus status, ReportReason reason, Long videoId,
                                                        Pageable pageable) {
        ReportStatus target = status == null ? ReportStatus.PENDING : status;
        return PageResponse.from(reportRepository.findForAdmin(target, reason, videoId, pageable)
                .map(AdminReportResponse::from));
    }

    /**
     * 처리 전(PENDING) 신고만 한 번 처리할 수 있다. 이미 처리한 신고는 다시 바꾸지 않는다.
     */
    @Transactional
    public ReportHandleResponse handle(Long reportId, ReportHandleRequest request) {
        Report report = reportRepository.findById(reportId)
                .orElseThrow(() -> new BusinessException(ErrorCode.REPORT_NOT_FOUND));
        if (!report.isPending()) {
            throw new BusinessException(ErrorCode.REPORT_ALREADY_HANDLED);
        }

        List<Report> targets = new ArrayList<>();
        targets.add(report);
        if (request.appliesToSameLine()) {
            reportRepository.findPendingByLineId(report.getLine().getId()).stream()
                    .filter(other -> !other.getId().equals(reportId))
                    .forEach(targets::add);
        }
        Instant now = Instant.now();
        targets.forEach(target -> target.handle(request.status(), now));

        List<Long> updatedIds = targets.stream().map(Report::getId).sorted().toList();
        return new ReportHandleResponse(report.getId(), report.getStatus(), report.getHandledAt(), updatedIds);
    }
}
