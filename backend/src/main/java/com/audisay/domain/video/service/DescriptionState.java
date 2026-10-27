package com.audisay.domain.video.service;

/**
 * 영상 하나의 해설 상태. 다시 만드는 중이면 descriptionId와 activeJobId가 둘 다 있다.
 *
 * @param descriptionId 지금 공개 중인(PUBLISHED) 해설
 * @param activeJobId   진행 중(QUEUED·RUNNING)인 작업
 */
public record DescriptionState(VideoDescriptionStatus status, Long descriptionId, Long activeJobId) {
    public static final DescriptionState NONE = new DescriptionState(VideoDescriptionStatus.NONE, null, null);
}
