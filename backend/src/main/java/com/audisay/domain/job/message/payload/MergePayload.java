package com.audisay.domain.job.message.payload;

import com.audisay.domain.job.entity.Pipeline;

import java.util.List;

public record MergePayload(
        Long videoId,
        Pipeline pipeline,
        List<Integer> succeededChunks,
        Integer coveredUntilMs,
        String modelName
) {
    public static MergePayload of(Long videoId, Pipeline pipeline, List<Integer> succeededChunks, Integer coveredUntilMs) {
        return new MergePayload(videoId, pipeline, succeededChunks, coveredUntilMs, null);
    }
}
