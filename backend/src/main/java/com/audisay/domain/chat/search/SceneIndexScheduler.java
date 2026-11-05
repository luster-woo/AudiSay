package com.audisay.domain.chat.search;

import com.audisay.global.external.embedding.EmbeddingClient;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;

/**
 * 5분마다(시작 3분 뒤): 보관 기간이 지난 해설의 색인 지우기 → 색인할 공개 해설(놓친 것·실패·멈춤·관리자 수정·모델 변경)을
 * batchSize개까지 색인. 배포 전 공개된 해설도 여기서 차례로 채운다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class SceneIndexScheduler {
    private final SceneSearchStore store;
    private final SceneIndexer indexer;
    private final EmbeddingClient embeddingClient;
    private final SceneSearchProperties properties;

    @Scheduled(fixedDelay = 300_000, initialDelay = 180_000)
    public void run() {
        if (properties.index().enabled()) {
            run(Instant.now());
        }
    }

    /** @return 색인을 끝낸(DONE) 해설 수 */
    int run(Instant now) {
        SceneSearchProperties.Index index = properties.index();
        try {
            int deleted = store.deleteArchived(now.minus(index.archivedRetention()));
            if (deleted > 0) {
                log.info("[장면 색인] 보관된 해설 색인 {}줄 삭제", deleted);
            }
        } catch (RuntimeException e) {
            log.warn("[장면 색인] 보관된 해설 정리 실패: {}", e.getMessage());
        }
        List<Long> candidates = store.findCandidates(embeddingClient.model(), now.minus(index.retryAfter()),
                now.minus(index.stuckAfter()), index.batchSize());
        int done = 0;
        for (Long descriptionId : candidates) {
            try {
                if (indexer.index(descriptionId) == SceneIndexer.Result.DONE) {
                    done++;
                }
            } catch (RuntimeException e) {
                log.warn("[장면 색인] descriptionId={} 처리 중 오류: {}", descriptionId, e.getMessage());
            }
        }
        if (!candidates.isEmpty()) {
            log.info("[장면 색인] 후보 {}개 중 {}개 색인", candidates.size(), done);
        }
        return done;
    }
}
