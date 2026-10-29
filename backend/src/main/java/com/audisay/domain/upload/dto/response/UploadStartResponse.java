package com.audisay.domain.upload.dto.response;

/**
 * @param partSizeBytes 조각 크기. 마지막 조각만 더 작을 수 있다
 * @param partCount     올려야 할 조각 수
 */
public record UploadStartResponse(Long videoId, long partSizeBytes, int partCount) {
}
