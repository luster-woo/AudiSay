package com.audisay.domain.video.dto.request;

import com.audisay.domain.video.entity.Visibility;
import jakarta.validation.constraints.NotNull;

public record VisibilityUpdateRequest(
        @NotNull(message = "공개 범위를 입력해 주세요.")
        Visibility visibility
) {
}
