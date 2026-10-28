package com.audisay.domain.video.repository;

import java.time.Instant;

/**
 * 내 영상 목록의 한 줄: 영상과 그 영상에 마지막으로 요청한 시각.
 */
public record MyVideoRow(Long videoId, Instant lastRequestedAt) {
}
