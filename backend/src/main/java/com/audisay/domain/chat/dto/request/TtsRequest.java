package com.audisay.domain.chat.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * @param voice F1~F5(여성)·M1~M5(남성). 없으면 F1
 */
public record TtsRequest(
        @NotBlank(message = "읽을 문장은 1~500자여야 합니다.")
        @Size(max = 500, message = "읽을 문장은 1~500자여야 합니다.")
        String text,
        @Pattern(regexp = "^[FM][1-5]$", message = "목소리는 F1~F5, M1~M5 중 하나여야 합니다.")
        String voice
) {
}
