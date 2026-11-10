package com.audisay.domain.admin.dto.request;

import com.audisay.domain.report.entity.ReportStatus;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotNull;

/**
 * @param applyToSameLine true면 같은 문장의 다른 처리 전 신고도 같은 상태로 바꾼다. 기본 false
 */
public record ReportHandleRequest(
        @NotNull(message = "처리 상태를 입력해 주세요.")
        ReportStatus status,

        Boolean applyToSameLine
) {
    @AssertTrue(message = "신고는 RESOLVED 또는 REJECTED로만 바꿀 수 있어요.")
    public boolean isStatusHandled() {
        return status != ReportStatus.PENDING;
    }

    public boolean appliesToSameLine() {
        return Boolean.TRUE.equals(applyToSameLine);
    }
}
