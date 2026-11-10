package com.audisay.domain.report.dto.request;

import com.audisay.domain.report.entity.ReportReason;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

/**
 * @param reasonDetail OTHER면 필수. 다른 사유는 선택
 */
public record ReportCreateRequest(
        @NotNull(message = "신고한 영상 시각을 입력해 주세요.")
        @PositiveOrZero(message = "영상 시각은 0 이상이어야 합니다.")
        Integer reportedAtMs,

        @NotNull(message = "신고 사유를 선택해 주세요.")
        ReportReason reason,

        @Size(max = 500, message = "신고 내용은 500자 이하여야 해요.")
        String reasonDetail
) {
    @AssertTrue(message = "기타 사유는 내용을 입력해 주세요.")
    public boolean isReasonDetailValid() {
        return reason != ReportReason.OTHER || (reasonDetail != null && !reasonDetail.isBlank());
    }
}
