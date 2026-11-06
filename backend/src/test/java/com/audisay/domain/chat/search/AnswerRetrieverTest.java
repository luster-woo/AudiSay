package com.audisay.domain.chat.search;

import com.audisay.global.external.embedding.EmbeddingClient;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.QueryTimeoutException;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AnswerRetrieverTest {
    private static final long DESC = 52000001L;
    private static final String MODEL = "test-embedding";
    private static final float[] VECTOR = {0.1f, 0.2f};

    private SceneSearchStore store;
    private AnswerRetriever retriever;

    @BeforeEach
    void setUp() {
        store = mock(SceneSearchStore.class);
        EmbeddingClient embeddingClient = mock(EmbeddingClient.class);
        when(embeddingClient.model()).thenReturn(MODEL);
        retriever = new AnswerRetriever(store, embeddingClient, new SceneSearchProperties(null, null, null));
    }

    @Test
    void 찾은_해설_옆의_대사와_화면_글자를_함께_시간순으로_돌려준다() {
        VectorLine narration = line("NARRATION", 1, 239_000, "'이강철 KT WIZ 감독'의 인터뷰가 시작된다.", 0.8);
        when(store.searchLines(DESC, MODEL, VECTOR, 8, 0, 240_000)).thenReturn(List.of(narration));
        when(store.linesAround(DESC, MODEL, List.of(239_000), AnswerRetriever.NEIGHBOR_MS, 240_000)).thenReturn(List.of(
                line("SCREEN", 7, 239_000, "이강철 KT WIZ 감독", 0),
                line("NARRATION", 1, 239_000, "'이강철 KT WIZ 감독'의 인터뷰가 시작된다.", 0),
                line("DIALOGUE", 3, 239_500, "야구 하면서 참 오늘 같은 경기를", 0)));

        List<VectorLine> lines = retriever.before(DESC, VECTOR, 240_000);

        assertThat(lines).extracting(VectorLine::sourceType).containsExactly("NARRATION", "SCREEN", "DIALOGUE");
        assertThat(lines.get(0).similarity()).isEqualTo(0.8);
    }

    @Test
    void 옆_줄은_질문_시각_자료_앞까지만_붙인다() {
        when(store.searchLines(DESC, MODEL, VECTOR, 8, 0, 240_000))
                .thenReturn(List.of(line("NARRATION", 1, 238_000, "감독 인터뷰", 0.8)));
        when(store.linesAround(DESC, MODEL, List.of(238_000), AnswerRetriever.NEIGHBOR_MS, 240_000))
                .thenReturn(List.of(line("DIALOGUE", 3, 241_000, "지금 자료에 있는 대사", 0)));

        assertThat(retriever.before(DESC, VECTOR, 240_000)).extracting(VectorLine::sourceId).containsExactly(1L);
    }

    @Test
    void 옆_줄은_찾은_줄에_가까운_것부터_상한까지만() {
        List<VectorLine> hits = new ArrayList<>();
        for (int i = 0; i < 8; i++) {
            hits.add(line("NARRATION", i, i * 20_000, "찾은 줄", 0.5));
        }
        List<VectorLine> around = new ArrayList<>();
        for (int i = 0; i < 8; i++) {
            for (int d = 1; d <= 4; d++) {
                around.add(line("DIALOGUE", i * 10 + d, i * 20_000 + d * 1_000, "옆 대사", 0));
            }
        }
        when(store.searchLines(DESC, MODEL, VECTOR, 8, 0, 200_000)).thenReturn(hits);
        when(store.linesAround(eq(DESC), eq(MODEL), anyList(), eq(AnswerRetriever.NEIGHBOR_MS), eq(200_000)))
                .thenReturn(around);

        List<VectorLine> lines = retriever.before(DESC, VECTOR, 200_000);

        assertThat(lines).hasSize(AnswerRetriever.MAX_EARLIER_LINES);
        assertThat(lines.stream().filter(l -> "DIALOGUE".equals(l.sourceType())))
                .allMatch(l -> l.startMs() % 20_000 <= 2_000);
        assertThat(lines).extracting(VectorLine::startMs).isSorted();
    }

    @Test
    void 옆_줄을_못_읽으면_찾은_줄만() {
        List<VectorLine> hits = List.of(line("NARRATION", 1, 100_000, "감독 인터뷰", 0.8));
        when(store.searchLines(DESC, MODEL, VECTOR, 8, 0, 240_000)).thenReturn(hits);
        when(store.linesAround(anyLong(), anyString(), anyList(), anyInt(), anyInt()))
                .thenThrow(new QueryTimeoutException("timeout"));

        assertThat(retriever.before(DESC, VECTOR, 240_000)).isEqualTo(hits);
    }

    @Test
    void 찾은_줄이_없으면_옆_줄을_읽지_않는다() {
        when(store.searchLines(eq(DESC), eq(MODEL), any(), anyInt(), anyInt(), anyInt())).thenReturn(List.of());

        assertThat(retriever.before(DESC, VECTOR, 240_000)).isEmpty();
        verify(store, never()).linesAround(anyLong(), anyString(), anyList(), anyInt(), anyInt());
    }

    @Test
    void 뒤_확인은_옆_줄을_붙이지_않는다() {
        when(store.searchLines(DESC, MODEL, VECTOR, 12, 300_001, Integer.MAX_VALUE))
                .thenReturn(List.of(line("DIALOGUE", 1, 320_000, "뒤 대사", 0.7)));

        assertThat(retriever.after(DESC, VECTOR, 300_000)).hasSize(1);
        verify(store, never()).linesAround(anyLong(), anyString(), anyList(), anyInt(), anyInt());
    }

    @Test
    void 끝난_장면_제목은_글자_수_상한까지_최근_장면부터_남긴다() {
        String longTitle = "가".repeat(1_000);
        when(store.chapterTitlesBefore(DESC, 310_000)).thenReturn(List.of(new ChapterTitle(0, longTitle),
                new ChapterTitle(10_000, longTitle), new ChapterTitle(20_000, longTitle), new ChapterTitle(30_000, longTitle)));

        assertThat(retriever.pastTitles(DESC, 310_000)).extracting(ChapterTitle::startMs)
                .containsExactly(10_000, 20_000, 30_000);
    }

    @Test
    void 장면_제목을_못_읽으면_빈_목록() {
        when(store.chapterTitlesBefore(anyLong(), anyInt())).thenThrow(new QueryTimeoutException("timeout"));

        assertThat(retriever.pastTitles(DESC, 310_000)).isEmpty();
    }

    private static VectorLine line(String type, long id, int startMs, String text, double similarity) {
        return new VectorLine(type, id, startMs, text, similarity);
    }
}
