package com.audisay.domain.report.service;

import com.audisay.domain.description.entity.DescriptionLine;
import com.audisay.domain.description.repository.DescriptionLineRepository;
import com.audisay.domain.report.dto.request.ReportCreateRequest;
import com.audisay.domain.report.dto.response.ReportCreateResponse;
import com.audisay.domain.report.entity.Report;
import com.audisay.domain.report.repository.ReportRepository;
import com.audisay.domain.video.entity.Video;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import com.audisay.global.security.AuthUser;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class ReportService {
    private final ReportRepository reportRepository;
    private final DescriptionLineRepository descriptionLineRepository;

    /**
     * 볼 수 없는 영상(남의 비공개 업로드)의 문장은 신고할 수 없다.
     * 해설 상태는 보지 않는다. 다시 만들기로 보관(ARCHIVED)된 해설이라도 회원이 들은 문장이면 받는다.
     */
    @Transactional
    public ReportCreateResponse report(AuthUser authUser, Long lineId, ReportCreateRequest request) {
        DescriptionLine line = descriptionLineRepository.findById(lineId)
                .orElseThrow(() -> new BusinessException(ErrorCode.DESCRIPTION_LINE_NOT_FOUND));
        Video video = line.getDescription().getVideo();
        if (!video.isViewableBy(authUser.userId(), authUser.role())) {
            throw new BusinessException(ErrorCode.VIDEO_PRIVATE);
        }
        if (reportRepository.existsByUserIdAndLine_Id(authUser.userId(), lineId)) {
            throw new BusinessException(ErrorCode.ALREADY_REPORTED);
        }

        Report report = Report.create(line, authUser.userId(), request.reportedAtMs(),
                request.reason(), request.reasonDetail());
        try {
            reportRepository.saveAndFlush(report);
        } catch (DataIntegrityViolationException e) {
            // 같은 신고가 동시에 들어와 uq_reports_user_line에 걸린 경우
            throw new BusinessException(ErrorCode.ALREADY_REPORTED);
        }
        return ReportCreateResponse.from(report);
    }
}
