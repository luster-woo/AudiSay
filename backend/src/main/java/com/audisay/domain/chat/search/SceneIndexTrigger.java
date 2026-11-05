package com.audisay.domain.chat.search;

import com.audisay.domain.description.event.DescriptionPublishedEvent;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 해설 공개가 커밋되면 바로 색인한다(전용 스레드 하나, 차례대로). 놓치거나(서버 재시작·대기열 가득) 실패하면 스케줄러가 맡는다.
 * Executor 빈으로 등록하면 Spring Boot 기본 applicationTaskExecutor가 빠지므로 빈 안에 둔다.
 */
@Slf4j
@Component
public class SceneIndexTrigger {
    private final SceneIndexer indexer;
    private final SceneSearchProperties properties;
    private final ThreadPoolTaskExecutor executor;

    public SceneIndexTrigger(SceneIndexer indexer, SceneSearchProperties properties) {
        this.indexer = indexer;
        this.properties = properties;
        ThreadPoolTaskExecutor pool = new ThreadPoolTaskExecutor();
        pool.setCorePoolSize(1);
        pool.setMaxPoolSize(1);
        pool.setQueueCapacity(50);
        pool.setThreadNamePrefix("scene-index-");
        pool.setDaemon(true);
        pool.initialize();
        this.executor = pool;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onPublished(DescriptionPublishedEvent event) {
        if (!properties.index().enabled()) {
            return;
        }
        try {
            executor.execute(() -> {
                try {
                    indexer.index(event.descriptionId());
                } catch (RuntimeException e) {
                    log.warn("[장면 색인] 공개 직후 색인 오류 descriptionId={}: {}", event.descriptionId(), e.getMessage());
                }
            });
        } catch (TaskRejectedException e) {
            log.warn("[장면 색인] 대기열이 가득 차 스케줄러에 맡김 descriptionId={}", event.descriptionId());
        }
    }

    @PreDestroy
    public void shutdown() {
        executor.shutdown();
    }
}
