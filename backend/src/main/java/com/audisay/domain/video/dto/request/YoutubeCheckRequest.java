package com.audisay.domain.video.dto.request;

import jakarta.validation.constraints.NotBlank;

public record YoutubeCheckRequest(
        @NotBlank(message = "유튜브 링크를 입력해 주세요.")
        String url
) {
}
