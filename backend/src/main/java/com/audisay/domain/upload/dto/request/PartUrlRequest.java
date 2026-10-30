package com.audisay.domain.upload.dto.request;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import java.util.List;

/**
 * @param partNumbers 주소가 필요한 조각 번호(1부터). 한 번에 최대 20개
 */
public record PartUrlRequest(
        @NotEmpty(message = "조각 번호를 입력해 주세요.")
        @Size(max = 20, message = "조각 주소는 한 번에 20개까지 받을 수 있습니다.")
        List<@NotNull(message = "조각 번호를 입력해 주세요.") @Positive(message = "조각 번호는 1부터입니다.") Integer> partNumbers
) {
}
