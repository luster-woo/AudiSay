package com.audisay.domain.job.service;

import com.audisay.domain.job.entity.JobChunk;
import com.audisay.domain.job.entity.JobChunkStatus;

import java.util.ArrayList;
import java.util.List;

final class ChunkCoverage {
    private ChunkCoverage() {
    }

    /** 0번부터 끊기지 않고 성공한 조각 번호. chunks는 chunkIndex 순서 */
    static List<Integer> succeededPrefix(List<JobChunk> chunks) {
        List<Integer> indexes = new ArrayList<>();
        for (JobChunk chunk : chunks) {
            if (chunk.getStatus() != JobChunkStatus.SUCCEEDED) {
                break;
            }
            indexes.add(chunk.getChunkIndex());
        }
        return indexes;
    }

    /** 모든 조각이 성공했거나 하나도 성공 못 했으면 null */
    static Integer coveredUntilMs(List<JobChunk> chunks) {
        List<Integer> covered = succeededPrefix(chunks);
        if (covered.isEmpty() || covered.size() == chunks.size()) {
            return null;
        }
        return chunks.get(covered.size() - 1).getEndMs();
    }
}
