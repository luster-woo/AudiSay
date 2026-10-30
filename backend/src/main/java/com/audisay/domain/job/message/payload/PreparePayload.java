package com.audisay.domain.job.message.payload;

import com.audisay.domain.job.entity.Pipeline;

/** job.prepare. 유튜브는 youtubeUrl, 업로드는 originalKey(S3 원본)를 채운다 */
public record PreparePayload(
        Long videoId,
        Pipeline pipeline,
        String youtubeUrl,
        String originalKey,
        int durationSec,
        String title,
        int chunkSec
) {
    private static final int DEFAULT_CHUNK_SEC = 120;

    public static PreparePayload youtube(Long videoId, String youtubeUrl, int durationSec, String title) {
        return new PreparePayload(videoId, Pipeline.GEMINI_URL, youtubeUrl, null, durationSec, title, DEFAULT_CHUNK_SEC);
    }

    public static PreparePayload upload(Long videoId, String originalKey, int durationSec, String title) {
        return new PreparePayload(videoId, Pipeline.LOCAL, null, originalKey, durationSec, title, DEFAULT_CHUNK_SEC);
    }
}
