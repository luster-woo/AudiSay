package com.audisay.domain.chat.dto.request;

import com.audisay.domain.chat.entity.InputMode;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * 영상 밖 챗봇(검색 화면 등)이면 videoId·descriptionId·videoTimeMs를 비운다
 *
 * @param videoTimeMs 챗봇 키를 누른 순간의 영상 시각
 * @param utterance   입력 문장(음성이면 STT 결과)
 */
public record ChatMessageRequest(
        Long videoId,
        Long descriptionId,
        @Min(value = 0, message = "영상 시각은 0 이상이어야 합니다.")
        Integer videoTimeMs,
        @NotBlank(message = "입력 문장은 1~500자여야 해요.")
        @Size(max = 500, message = "입력 문장은 1~500자여야 해요.")
        String utterance,
        @NotNull(message = "입력 방식(TEXT/VOICE)을 입력해 주세요.")
        InputMode inputMode
) {
}
