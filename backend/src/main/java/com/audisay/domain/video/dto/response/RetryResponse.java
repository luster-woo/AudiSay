package com.audisay.domain.video.dto.response;

import com.audisay.domain.video.entity.GenerationResult;

/**
 * @param counted             항상 false. 실패는 사용자 책임이 아니라 하루 이용 횟수를 차감하지 않는다
 * @param retryRemainingToday 이 영상을 오늘 더 다시 요청할 수 있는 횟수
 */
public record RetryResponse(
        Long videoId,
        Long jobId,
        GenerationResult result,
        boolean counted,
        int retryRemainingToday
) {
}
