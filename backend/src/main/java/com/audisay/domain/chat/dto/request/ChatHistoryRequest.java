package com.audisay.domain.chat.dto.request;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Positive;

/**
 * @param cursor 앞 페이지의 nextCursor. 첫 페이지면 비운다
 */
public record ChatHistoryRequest(
        @Positive(message = "cursor는 1 이상이어야 합니다.")
        Long cursor,

        @Min(value = 1, message = "페이지 크기는 1~50이어야 합니다.")
        @Max(value = 50, message = "페이지 크기는 1~50이어야 합니다.")
        Integer size
) {
    private static final int DEFAULT_SIZE = 20;

    public int sizeOrDefault() {
        return size == null ? DEFAULT_SIZE : size;
    }
}
