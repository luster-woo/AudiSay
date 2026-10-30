package com.audisay.domain.video.dto.response;

import com.audisay.domain.video.entity.GenerationResult;

/**
 * @param jobId         NEW_JOB·JOINED_JOB일 때 진행률을 구독할 작업
 * @param descriptionId REUSED일 때 바로 재생할 공개 해설
 * @param counted       이번 요청으로 하루 이용 횟수를 차감했는지
 * @param remaining     오늘 남은 유튜브 해설 요청 횟수. 관리자는 제한이 없어 null
 */
public record YoutubeRequestResponse(
        Long videoId,
        GenerationResult result,
        Long jobId,
        Long descriptionId,
        boolean counted,
        Integer remaining
) {
}
