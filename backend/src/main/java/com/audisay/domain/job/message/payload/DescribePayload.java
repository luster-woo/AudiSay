package com.audisay.domain.job.message.payload;

import com.audisay.domain.job.entity.JobChunk;
import com.audisay.domain.job.entity.Pipeline;

public record DescribePayload(
        int chunkIndex,
        int startMs,
        int endMs,
        Pipeline pipeline,
        String youtubeUrl,
        String contextSummary,
        String category
) {
    public static DescribePayload of(JobChunk chunk, Pipeline pipeline, String youtubeUrl, String category) {
        return new DescribePayload(chunk.getChunkIndex(), chunk.getStartMs(), chunk.getEndMs(), pipeline, youtubeUrl,
                chunk.getContextSummary(), category);
    }
}
