package com.audisay.domain.job.message.result;

import java.util.List;

/**
 * @param playbackKey LOCAL(업로드)만. ffmpeg로 변환한 재생용 파일의 S3 키
 */
public record PrepareResult(String category, String playbackKey, List<Chunk> chunks) {

    public record Chunk(int chunkIndex, int startMs, int endMs, String contextSummary) {
    }
}
