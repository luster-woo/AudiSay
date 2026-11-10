package com.audisay.domain.video.dto.request;

import jakarta.validation.constraints.Size;

/**
 * @param q 영상 제목이나 채널명 일부. 대소문자를 가리지 않고, 비우면 전체 목록
 */
public record VideoListRequest(
        @Size(max = 100, message = "검색어는 100자 이하여야 해요.")
        String q
) {
}
