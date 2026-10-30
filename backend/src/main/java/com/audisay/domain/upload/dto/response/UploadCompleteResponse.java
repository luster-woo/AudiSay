package com.audisay.domain.upload.dto.response;

import com.audisay.domain.video.entity.GenerationResult;

/**
 * @param remaining 오늘 남은 업로드 횟수. 관리자는 제한이 없어 null
 */
public record UploadCompleteResponse(Long videoId, Long jobId, GenerationResult result, Integer remaining) {
}
