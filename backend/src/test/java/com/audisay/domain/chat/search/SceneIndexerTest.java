package com.audisay.domain.chat.search;

import com.audisay.domain.chat.search.SceneSearchStore.DescriptionRef;
import com.audisay.global.external.embedding.EmbeddingClient;
import com.audisay.global.external.llm.LlmException;
import com.audisay.global.external.llm.LlmException.Kind;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SceneIndexerTest {
    private static final long DESCRIPTION_ID = 52000001L;
    private static final long JOB_ID = 31L;
    private static final String MODEL = "test-embedding";

    private SceneSearchStore store;
    private EmbeddingClient embeddingClient;
    private SceneIndexer indexer;

    @BeforeEach
    void setUp() {
        store = mock(SceneSearchStore.class);
        embeddingClient = mock(EmbeddingClient.class);
        when(embeddingClient.model()).thenReturn(MODEL);
        indexer = new SceneIndexer(store, embeddingClient, new SceneSearchProperties(null, null, null),
                new TransactionTemplate(mock(PlatformTransactionManager.class)), new SimpleMeterRegistry());
    }

    @Test
    void 공개된_해설이면_줄을_순서대로_임베딩해_바꾸고_DONE() {
        published();
        when(store.claim(eq(DESCRIPTION_ID), eq(MODEL), any())).thenReturn(true);
        List<SceneSourceLine> lines = List.of(
                new SceneSourceLine("SCENE", 1L, 0, "바삭한 츄러스를 만듭니다."),
                new SceneSourceLine("NARRATION", 2L, 15000, "버터를 녹입니다."));
        when(store.readSources(DESCRIPTION_ID)).thenReturn(lines);
        List<float[]> vectors = List.of(new float[]{1, 0}, new float[]{0, 1});
        when(embeddingClient.embedDocuments(List.of("바삭한 츄러스를 만듭니다.", "버터를 녹입니다."), JOB_ID)).thenReturn(vectors);

        assertThat(indexer.index(DESCRIPTION_ID)).isEqualTo(SceneIndexer.Result.DONE);

        verify(store).replace(DESCRIPTION_ID, MODEL, lines, vectors);
        verify(store, never()).markFailed(anyLong(), anyString());
    }

    @Test
    void 줄이_없으면_임베딩_없이_0줄로_DONE() {
        published();
        when(store.claim(eq(DESCRIPTION_ID), eq(MODEL), any())).thenReturn(true);
        when(store.readSources(DESCRIPTION_ID)).thenReturn(List.of());

        assertThat(indexer.index(DESCRIPTION_ID)).isEqualTo(SceneIndexer.Result.DONE);

        verify(embeddingClient, never()).embedDocuments(anyList(), any());
        verify(store).replace(DESCRIPTION_ID, MODEL, List.of(), List.of());
    }

    @Test
    void 임베딩이_실패하면_저장하지_않고_FAILED와_오류_종류를_남긴다() {
        published();
        when(store.claim(eq(DESCRIPTION_ID), eq(MODEL), any())).thenReturn(true);
        when(store.readSources(DESCRIPTION_ID)).thenReturn(List.of(new SceneSourceLine("DIALOGUE", 3L, 8000, "환영합니다.")));
        when(embeddingClient.embedDocuments(anyList(), any()))
                .thenThrow(new LlmException(Kind.RATE_LIMIT, 429, "limit", null));

        assertThat(indexer.index(DESCRIPTION_ID)).isEqualTo(SceneIndexer.Result.FAILED);

        verify(store).markFailed(DESCRIPTION_ID, "RATE_LIMIT");
        verify(store, never()).replace(anyLong(), anyString(), anyList(), anyList());
    }

    @Test
    void 다른_곳에서_색인_중이면_건너뛴다() {
        published();
        when(store.claim(eq(DESCRIPTION_ID), eq(MODEL), any())).thenReturn(false);

        assertThat(indexer.index(DESCRIPTION_ID)).isEqualTo(SceneIndexer.Result.BUSY);

        verify(store, never()).readSources(anyLong());
        verify(embeddingClient, never()).embedDocuments(anyList(), any());
    }

    @Test
    void 공개되지_않은_해설은_맡지_않는다() {
        when(store.findDescription(DESCRIPTION_ID))
                .thenReturn(Optional.of(new DescriptionRef(DESCRIPTION_ID, JOB_ID, "ARCHIVED")));

        assertThat(indexer.index(DESCRIPTION_ID)).isEqualTo(SceneIndexer.Result.NOT_PUBLISHED);

        verify(store, never()).claim(anyLong(), anyString(), any());
    }

    private void published() {
        when(store.findDescription(DESCRIPTION_ID))
                .thenReturn(Optional.of(new DescriptionRef(DESCRIPTION_ID, JOB_ID, "PUBLISHED")));
    }
}
