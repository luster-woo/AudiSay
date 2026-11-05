package com.audisay.domain.chat.search;

import com.audisay.domain.chat.search.SceneSearchStore.DescriptionRef;
import com.audisay.global.external.embedding.EmbeddingClient;
import com.audisay.global.external.llm.LlmException;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.TimeUnit;

/**
 * 공개 해설 하나의 줄을 모두 임베딩해 scene_search_lines를 통째로 바꾼다.
 * 맡기(PENDING) → 줄 읽기 → 임베딩(트랜잭션 밖) → 저장·DONE(짧은 트랜잭션). 실패면 FAILED + 오류 종류, 스케줄러가 retryAfter 뒤 다시.
 * 지표 audisay.scene_index{result}
 */
@Slf4j
@Service
public class SceneIndexer {
    private static final String PUBLISHED = "PUBLISHED";

    public enum Result { DONE, FAILED, NOT_PUBLISHED, BUSY }

    private final SceneSearchStore store;
    private final EmbeddingClient embeddingClient;
    private final SceneSearchProperties properties;
    private final TransactionTemplate transactionTemplate;
    private final MeterRegistry meterRegistry;

    public SceneIndexer(SceneSearchStore store, EmbeddingClient embeddingClient, SceneSearchProperties properties,
                        TransactionTemplate transactionTemplate, MeterRegistry meterRegistry) {
        this.store = store;
        this.embeddingClient = embeddingClient;
        this.properties = properties;
        this.transactionTemplate = transactionTemplate;
        this.meterRegistry = meterRegistry;
    }

    public Result index(long descriptionId) {
        long start = System.nanoTime();
        Optional<DescriptionRef> description = store.findDescription(descriptionId);
        if (description.isEmpty() || !PUBLISHED.equals(description.get().status())) {
            return finish(Result.NOT_PUBLISHED, start);
        }
        String model = embeddingClient.model();
        if (!store.claim(descriptionId, model, Instant.now().minus(properties.index().stuckAfter()))) {
            return finish(Result.BUSY, start);
        }
        try {
            List<SceneSourceLine> lines = store.readSources(descriptionId);
            List<float[]> vectors = lines.isEmpty() ? List.of()
                    : embeddingClient.embedDocuments(lines.stream().map(SceneSourceLine::text).toList(),
                    description.get().jobId());
            transactionTemplate.executeWithoutResult(status -> store.replace(descriptionId, model, lines, vectors));
            log.info("[장면 색인] descriptionId={} {}줄 ({}ms)", descriptionId, lines.size(), elapsedMs(start));
            return finish(Result.DONE, start);
        } catch (LlmException e) {
            return fail(descriptionId, e.getKind().name(), e, start);
        } catch (RuntimeException e) {
            return fail(descriptionId, "UNKNOWN", e, start);
        }
    }

    private Result fail(long descriptionId, String errorCode, RuntimeException e, long start) {
        log.warn("[장면 색인] 실패 descriptionId={} {} - {}", descriptionId, errorCode, e.getMessage());
        try {
            store.markFailed(descriptionId, errorCode);
        } catch (RuntimeException markError) {
            log.warn("[장면 색인] FAILED 기록 실패 descriptionId={} ({}), stuckAfter 뒤 다시 맡음", descriptionId,
                    markError.getMessage());
        }
        return finish(Result.FAILED, start);
    }

    private Result finish(Result result, long start) {
        Timer.builder("audisay.scene_index")
                .description("장면 검색 색인 시간")
                .tag("result", result.name())
                .register(meterRegistry)
                .record(elapsedMs(start), TimeUnit.MILLISECONDS);
        return result;
    }

    private static long elapsedMs(long start) {
        return Duration.ofNanos(System.nanoTime() - start).toMillis();
    }
}
