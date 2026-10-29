package com.audisay.domain.job.message.result;

import java.util.List;

public record PrepareResult(String category, List<Chunk> chunks) {

    public record Chunk(int chunkIndex, int startMs, int endMs, String contextSummary) {
    }
}
