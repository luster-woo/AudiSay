package com.audisay.domain.admin.dto.request;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * @param importance 1~3. 보내지 않으면 그대로 둔다. 문장을 빼고 싶으면 1로 낮춘다
 */
public record LineUpdateRequest(
        @NotBlank(message = "해설 문장을 입력해 주세요.")
        @Size(max = 500, message = "해설 문장은 500자 이하여야 해요.")
        String text,

        @Min(value = 1, message = "중요도는 1~3이어야 합니다.")
        @Max(value = 3, message = "중요도는 1~3이어야 합니다.")
        Integer importance
) {
    public Short importanceOrNull() {
        return importance == null ? null : importance.shortValue();
    }
}
