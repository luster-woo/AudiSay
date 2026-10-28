package com.audisay.domain.user.dto.response;

import com.audisay.domain.user.entity.Role;

import java.time.LocalDate;

/**
 * 오늘(KST) 이용 한도. 관리자는 제한이 없어 제한 값(maxDurationSec, maxSizeBytes, limit, remaining)이 null이다.
 */
public record QuotaResponse(Role role, LocalDate date, YoutubeQuota youtube, UploadQuota upload) {

    public record YoutubeQuota(Integer maxDurationSec, Integer limit, long used, Integer remaining) {
    }

    public record UploadQuota(Integer maxDurationSec, Long maxSizeBytes, Integer limit, long used, Integer remaining) {
    }
}
