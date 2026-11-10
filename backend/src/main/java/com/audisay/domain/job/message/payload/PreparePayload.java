package com.audisay.domain.job.message.payload;

import com.audisay.domain.job.entity.Pipeline;

/**
 * job.prepare. 유튜브는 youtubeUrl, 업로드는 originalKey(S3 원본)를 채운다.
 *
 * @param skipCache 관리자 '해설 다시 만들기'(REGENERATE)면 true. AI가 같은 유튜브 영상의 예전 Gemini 결과(캐시·시드)를
 *                  다시 쓰지 않고 새로 부른 뒤 캐시를 덮어쓴다 (예전 결과를 쓰면 같은 해설이 나와 다시 만들기가 소용없었다)
 */
public record PreparePayload(
        Long videoId,
        Pipeline pipeline,
        String youtubeUrl,
        String originalKey,
        int durationSec,
        String title,
        int chunkSec,
        boolean skipCache
) {
    private static final int DEFAULT_CHUNK_SEC = 120;

    public static PreparePayload youtube(Long videoId, String youtubeUrl, int durationSec, String title) {
        return new PreparePayload(videoId, Pipeline.GEMINI_URL, youtubeUrl, null, durationSec, title, DEFAULT_CHUNK_SEC,
                false);
    }

    public static PreparePayload upload(Long videoId, String originalKey, int durationSec, String title) {
        return new PreparePayload(videoId, Pipeline.LOCAL, null, originalKey, durationSec, title, DEFAULT_CHUNK_SEC,
                false);
    }

    /** 해설 다시 만들기용: 예전 Gemini 결과를 다시 쓰지 않게 한다 */
    public PreparePayload regenerate() {
        return new PreparePayload(videoId, pipeline, youtubeUrl, originalKey, durationSec, title, chunkSec, true);
    }
}
