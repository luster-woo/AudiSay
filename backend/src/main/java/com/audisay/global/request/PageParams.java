package com.audisay.global.request;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;

/**
 * 목록 API 공통 쿼리 파라미터 (page 0부터·기본 0, size 기본 20·최대 50). 정렬은 API마다 정해져 있어 받지 않는다.
 * 컨트롤러에서 {@code @Valid @ModelAttribute PageParams pageParams}로 받는다.
 */
public record PageParams(
        @Min(value = 0, message = "페이지 번호는 0 이상이어야 합니다.")
        Integer page,

        @Min(value = 1, message = "페이지 크기는 1~50이어야 합니다.")
        @Max(value = 50, message = "페이지 크기는 1~50이어야 합니다.")
        Integer size
) {
    private static final int DEFAULT_SIZE = 20;

    public Pageable toPageable() {
        return PageRequest.of(page == null ? 0 : page, size == null ? DEFAULT_SIZE : size);
    }
}
