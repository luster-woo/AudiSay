package com.audisay.domain.video.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * @param pageToken 앞 검색 결과의 nextPageToken. 첫 페이지면 비운다
 */
public record YoutubeSearchRequest(
        @NotBlank(message = "검색어를 입력해 주세요.")
        @Size(max = 100, message = "검색어는 100자 이하여야 해요.")
        String q,

        String pageToken
) {
}
