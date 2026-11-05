package com.audisay.domain.chat.seek;

import com.audisay.domain.chat.entity.SeekSource;
import com.audisay.domain.chat.ratelimit.ChatRateLimiter;
import com.audisay.domain.chat.search.SceneSearchProperties;
import com.audisay.domain.chat.search.SceneVectorSearch;
import com.audisay.domain.chat.search.VectorLine;
import com.audisay.domain.chat.tuning.ChatTuningProperties;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import com.audisay.global.external.llm.GmsProperties;
import com.audisay.global.external.llm.LlmException;
import com.audisay.global.external.llm.LlmPurpose;
import com.audisay.domain.chat.seek.KeywordSceneScorer.Hit;
import com.audisay.domain.description.service.SceneText;
import com.audisay.domain.description.service.SceneText.Moment;
import com.audisay.domain.description.service.SceneText.MomentType;
import com.audisay.domain.description.service.SceneTextReader;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SceneSeekerTest {
    private static final long DESCRIPTION_ID = 500L;

    private final List<SceneText> scenes = List.of(
            new SceneText(1L, 1, 0, 600_000, "1회 초", "두산 공격", List.of("1회"), "",
                    List.of(new Moment(95_000, MomentType.DIALOGUE, "중견수 앞 안타!"))),
            new SceneText(2L, 2, 600_000, 1_200_000, "1회 말", "LG 공격", List.of("1회"), "",
                    List.of(new Moment(905_000, MomentType.NARRATION, "1루 주자가 2루로 달려 세이프"))));

    private SceneTextReader reader;
    private LlmSceneSelector selector;
    private LlmHitVerifier verifier;
    private ChatRateLimiter rateLimiter;
    private SimpleMeterRegistry meterRegistry;
    private GmsProperties gmsProperties;
    private SceneVectorSearch vectorSearch;
    private SceneSeeker seeker;

    @BeforeEach
    void setUp() {
        reader = mock(SceneTextReader.class);
        selector = mock(LlmSceneSelector.class);
        verifier = mock(LlmHitVerifier.class);
        rateLimiter = mock(ChatRateLimiter.class);
        meterRegistry = new SimpleMeterRegistry();
        gmsProperties = mock(GmsProperties.class);
        when(gmsProperties.timeout(LlmPurpose.SEEK)).thenReturn(Duration.ofSeconds(10));
        vectorSearch = mock(SceneVectorSearch.class);
        seeker = seeker(ChatTuningProperties.DEFAULT);
        when(reader.read(DESCRIPTION_ID)).thenReturn(scenes);
    }

    @Test
    void 키워드로_찾으면_LLM을_부르지_않는다() {
        SceneSeeker.Outcome outcome = seeker.seek(2L, DESCRIPTION_ID, "안타", 31L, 0);

        assertThat(outcome.source()).isEqualTo(SeekSource.KEYWORD);
        assertThat(outcome.hits()).extracting(Hit::targetMs).containsExactly(93_000);
        verify(selector, never()).select(anyString(), any(), any(), any());
        verify(rateLimiter, never()).acquireLlm(any());
        assertThat(meterRegistry.get("audisay.chat.seek").tag("source", "KEYWORD").tag("result", "single")
                .counter().count()).isEqualTo(1);
    }

    @Test
    void 키워드로_못_찾으면_LLM이_고른다() {
        Hit llmHit = new Hit(scenes.get(1), 903_000, 0, 1, null, "1루 주자가 2루로 달려 세이프", 1);
        when(selector.select("도루", scenes, 31L, 0)).thenReturn(List.of(llmHit));

        SceneSeeker.Outcome outcome = seeker.seek(2L, DESCRIPTION_ID, "도루", 31L, 0);

        assertThat(outcome.source()).isEqualTo(SeekSource.LLM);
        verify(rateLimiter).acquireLlm(2L);
        assertThat(outcome.hits()).containsExactly(llmHit);
    }

    @Test
    void LLM도_못_찾으면_빈_결과() {
        when(selector.select(anyString(), any(), any(), any())).thenReturn(List.of());

        SceneSeeker.Outcome outcome = seeker.seek(2L, DESCRIPTION_ID, "딸기 시럽", 31L, 0);

        assertThat(outcome.source()).isNull();
        assertThat(outcome.hits()).isEmpty();
        assertThat(meterRegistry.get("audisay.chat.seek").tag("source", "NONE").counter().count()).isEqualTo(1);
    }

    @Test
    void 대사에서만_찾은_후보가_여럿이면_LLM이_거른다() {
        when(reader.read(DESCRIPTION_ID)).thenReturn(talky("중견수 앞 안타!", "지금까지 안타 3개째입니다"));
        when(verifier.verify(anyString(), any(), any())).thenAnswer(invocation -> {
            List<Hit> hits = invocation.getArgument(1);
            return List.of(hits.get(0));
        });

        SceneSeeker.Outcome outcome = seeker.seek(2L, DESCRIPTION_ID, "안타", 31L, 0);

        assertThat(outcome.hits()).extracting(Hit::targetMs).containsExactly(93_000);
        assertThat(outcome.source()).isEqualTo(SeekSource.KEYWORD);
        verify(rateLimiter).acquireLlm(2L);
        assertThat(meterRegistry.get("audisay.chat.seek").tag("verified", "true").counter().count()).isEqualTo(1);
    }

    @Test
    void LLM_호출_한도에_걸리면_거르지_않고_후보를_그대로_준다() {
        when(reader.read(DESCRIPTION_ID)).thenReturn(talky("중견수 앞 안타!", "우전 안타!"));
        doThrow(new BusinessException(ErrorCode.CHAT_RATE_LIMIT)).when(rateLimiter).acquireLlm(2L);

        SceneSeeker.Outcome outcome = seeker.seek(2L, DESCRIPTION_ID, "안타", 31L, 0);

        assertThat(outcome.hits()).hasSize(2);
        verify(verifier, never()).verify(anyString(), any(), any());
    }

    @Test
    void 거르기를_끄면_후보를_그대로_준다() {
        when(reader.read(DESCRIPTION_ID)).thenReturn(talky("중견수 앞 안타!", "지금까지 안타 3개째입니다"));

        SceneSeeker.Outcome outcome = seeker(new ChatTuningProperties(true, true, true, true, false, true, true, true, true))
                .seek(2L, DESCRIPTION_ID, "안타", 31L, 0);

        assertThat(outcome.hits()).hasSize(2);
        verify(verifier, never()).verify(anyString(), any(), any());
    }

    @Test
    void 키워드_검색을_끄면_LLM이_고른다() {
        when(selector.select(anyString(), any(), any(), any())).thenReturn(List.of());

        seeker(new ChatTuningProperties(true, false, true, true, true, true, true, true, true)).seek(2L, DESCRIPTION_ID, "안타", 31L, 0);

        verify(selector).select("안타", scenes, 31L, 0);
    }

    @Test
    void 응답_시간_예산이_LLM_한_번보다_적게_남으면_거르지_않고_후보를_그대로_준다() {
        when(reader.read(DESCRIPTION_ID)).thenReturn(talky("중견수 앞 안타!", "우전 안타!"));

        SceneSeeker.Outcome outcome = seeker.seek(2L, DESCRIPTION_ID, "안타", 31L, 0, System.nanoTime() + 5_000_000_000L);

        assertThat(outcome.hits()).hasSize(2);
        verify(verifier, never()).verify(anyString(), any(), any());
        verify(verifier, never()).verify(anyString(), any(), any(), any());
    }

    @Test
    void 응답_시간_예산이_모자라면_LLM이_고르지_않고_못_찾음() {
        SceneSeeker.Outcome outcome = seeker.seek(2L, DESCRIPTION_ID, "홈런", 31L, 0, System.nanoTime() + 5_000_000_000L);

        assertThat(outcome.hits()).isEmpty();
        assertThat(outcome.timedOut()).isTrue();
        verify(selector, never()).select(anyString(), any(), any(), any());
        verify(selector, never()).select(anyString(), any(), any(), any(), any());
    }

    @Test
    void 응답_시간_예산이_있으면_LLM에_넘겨_대체_모델도_예산_안에서만_부른다() {
        long deadline = System.nanoTime() + 12_000_000_000L;
        when(selector.select(anyString(), any(), any(), any(), any())).thenReturn(List.of());

        SceneSeeker.Outcome outcome = seeker.seek(2L, DESCRIPTION_ID, "홈런", 31L, 0, deadline);

        assertThat(outcome.timedOut()).isFalse();
        verify(selector).select("홈런", scenes, 31L, 0, deadline);
    }

    @Test
    void 목차가_없으면_LLM을_부르지_않고_빈_결과() {
        when(reader.read(DESCRIPTION_ID)).thenReturn(List.of());

        assertThat(seeker.seek(2L, DESCRIPTION_ID, "안타", 31L, 0).hits()).isEmpty();
        verify(selector, never()).select(anyString(), any(), any(), any());
    }

    @Test
    void 검색어_낱말을_다_못_맞힌_후보는_LLM이_확인한_뒤_이동한다() {
        when(verifier.verify(anyString(), any(), any())).thenAnswer(invocation -> invocation.getArgument(1));

        SceneSeeker.Outcome outcome = seeker.seek(2L, DESCRIPTION_ID, "주자 2루 도루", 31L, 0);

        assertThat(outcome.source()).isEqualTo(SeekSource.KEYWORD);
        assertThat(outcome.hits()).extracting(Hit::targetMs).containsExactly(903_000);
        verify(verifier).verify(anyString(), any(), any());
        verify(selector, never()).select(anyString(), any(), any(), any());
    }

    @Test
    void 확인에서_모두_빠지면_LLM이_목차에서_다시_고른다() {
        when(verifier.verify(anyString(), any(), any())).thenReturn(List.of());
        when(selector.select(anyString(), any(), any(), any())).thenReturn(List.of());

        SceneSeeker.Outcome outcome = seeker.seek(2L, DESCRIPTION_ID, "주자 2루 도루", 31L, 0);

        assertThat(outcome.hits()).isEmpty();
        assertThat(outcome.source()).isNull();
        verify(selector).select("주자 2루 도루", scenes, 31L, 0);
    }

    @Test
    void 한_글자_낱말로_찾은_후보는_LLM이_확인한다() {
        when(reader.read(DESCRIPTION_ID)).thenReturn(List.of(new SceneText(1L, 1, 0, 600_000, "농장", "", List.of(), "",
                List.of(new Moment(5_000, MomentType.NARRATION, "숀이 우유 통 옆에서 잔다")))));
        when(verifier.verify(anyString(), any(), any())).thenReturn(List.of());
        when(selector.select(anyString(), any(), any(), any())).thenReturn(List.of());

        SceneSeeker.Outcome outcome = seeker.seek(2L, DESCRIPTION_ID, "숀이 우는", 31L, 0);

        assertThat(outcome.hits()).isEmpty();
        verify(verifier).verify(anyString(), any(), any());
    }

    @Test
    void 낱말_확인을_끄면_일부만_맞아도_바로_이동한다() {
        SceneSeeker.Outcome outcome = seeker(new ChatTuningProperties(true, true, true, true, true, true, false, true, true))
                .seek(2L, DESCRIPTION_ID, "주자 2루 도루", 31L, 0);

        assertThat(outcome.hits()).extracting(Hit::targetMs).containsExactly(903_000);
        verify(verifier, never()).verify(anyString(), any(), any());
    }

    @Test
    void FALLBACK_키워드가_확실하면_벡터_검색을_하지_않는다() {
        when(vectorSearch.ready(DESCRIPTION_ID)).thenReturn(true);

        SceneSeeker.Outcome outcome = seeker.seek(2L, DESCRIPTION_ID, "안타", 31L, 0);

        assertThat(outcome.source()).isEqualTo(SeekSource.KEYWORD);
        verify(vectorSearch, never()).search(anyLong(), anyString(), any(), anyInt());
    }

    @Test
    void FALLBACK_키워드로_못_찾으면_벡터_후보를_LLM이_확인해_RAG로_찾는다() {
        when(vectorSearch.ready(DESCRIPTION_ID)).thenReturn(true);
        when(vectorSearch.search(DESCRIPTION_ID, "도루", 31L, 20)).thenReturn(List.of(
                new VectorLine("NARRATION", 9L, 905_000, "1루 주자가 2루로 달려 세이프", 0.6)));
        when(verifier.check(eq("도루"), any(), eq(31L), any())).thenAnswer(invocation -> invocation.getArgument(1));

        SceneSeeker.Outcome outcome = seeker.seek(2L, DESCRIPTION_ID, "도루", 31L, 0);

        assertThat(outcome.source()).isEqualTo(SeekSource.RAG);
        assertThat(outcome.hits()).extracting(Hit::targetMs).containsExactly(903_000);
        assertThat(outcome.hits().get(0).moment()).isSameAs(scenes.get(1).moments().get(0));
        verify(selector, never()).select(anyString(), any(), any(), any());
        verify(rateLimiter).acquireLlm(2L);
    }

    @Test
    void RAG에서_LLM이_모두_빼면_못_찾음() {
        when(vectorSearch.ready(DESCRIPTION_ID)).thenReturn(true);
        when(vectorSearch.search(DESCRIPTION_ID, "홈런", 31L, 20)).thenReturn(List.of(
                new VectorLine("DIALOGUE", 3L, 95_000, "중견수 앞 안타!", 0.5)));
        when(verifier.check(eq("홈런"), any(), eq(31L), any())).thenReturn(List.of());

        SceneSeeker.Outcome outcome = seeker.seek(2L, DESCRIPTION_ID, "홈런", 31L, 0);

        assertThat(outcome.source()).isNull();
        assertThat(outcome.hits()).isEmpty();
        verify(selector, never()).select(anyString(), any(), any(), any());
    }

    @Test
    void RAG_확인이_실패하면_1등_후보_하나만_준다() {
        when(vectorSearch.ready(DESCRIPTION_ID)).thenReturn(true);
        when(vectorSearch.search(DESCRIPTION_ID, "도루", 31L, 20)).thenReturn(List.of(
                new VectorLine("NARRATION", 9L, 905_000, "1루 주자가 2루로 달려 세이프", 0.6),
                new VectorLine("DIALOGUE", 3L, 95_000, "중견수 앞 안타!", 0.4)));
        when(verifier.check(eq("도루"), any(), eq(31L), any())).thenReturn(null);

        SceneSeeker.Outcome outcome = seeker.seek(2L, DESCRIPTION_ID, "도루", 31L, 0);

        assertThat(outcome.source()).isEqualTo(SeekSource.RAG);
        assertThat(outcome.hits()).extracting(Hit::targetMs).containsExactly(903_000);
    }

    @Test
    void 임베딩이_실패하면_지금_방식으로_LLM이_고른다() {
        when(vectorSearch.ready(DESCRIPTION_ID)).thenReturn(true);
        when(vectorSearch.search(anyLong(), anyString(), any(), anyInt()))
                .thenThrow(new LlmException(LlmException.Kind.UNAVAILABLE, 0, "down", null));
        Hit llmHit = new Hit(scenes.get(1), 903_000, 0, 1, null, "1루 주자가 2루로 달려 세이프", 1);
        when(selector.select("도루", scenes, 31L, 0)).thenReturn(List.of(llmHit));

        SceneSeeker.Outcome outcome = seeker.seek(2L, DESCRIPTION_ID, "도루", 31L, 0);

        assertThat(outcome.source()).isEqualTo(SeekSource.LLM);
        assertThat(outcome.hits()).containsExactly(llmHit);
    }

    @Test
    void 색인이_없으면_임베딩을_부르지_않는다() {
        when(selector.select(anyString(), any(), any(), any())).thenReturn(List.of());

        seeker.seek(2L, DESCRIPTION_ID, "도루", 31L, 0);

        verify(vectorSearch, never()).search(anyLong(), anyString(), any(), anyInt());
    }

    @Test
    void ALWAYS면_키워드가_확실해도_키워드_후보를_LLM이_확인한다() {
        when(vectorSearch.ready(DESCRIPTION_ID)).thenReturn(true);
        when(vectorSearch.search(DESCRIPTION_ID, "안타", 31L, 20)).thenReturn(List.of());
        when(verifier.check(eq("안타"), any(), eq(31L), any())).thenAnswer(invocation -> invocation.getArgument(1));

        SceneSeeker.Outcome outcome = seeker(ChatTuningProperties.DEFAULT, SceneSearchProperties.Mode.ALWAYS)
                .seek(2L, DESCRIPTION_ID, "안타", 31L, 0);

        assertThat(outcome.source()).isEqualTo(SeekSource.RAG);
        assertThat(outcome.hits()).extracting(Hit::targetMs).containsExactly(93_000);
    }

    @Test
    void OFF면_키워드로_못_찾아도_벡터_검색을_하지_않는다() {
        when(vectorSearch.ready(DESCRIPTION_ID)).thenReturn(true);
        when(selector.select(anyString(), any(), any(), any())).thenReturn(List.of());

        seeker(ChatTuningProperties.DEFAULT, SceneSearchProperties.Mode.OFF).seek(2L, DESCRIPTION_ID, "도루", 31L, 0);

        verify(vectorSearch, never()).search(anyLong(), anyString(), any(), anyInt());
    }

    private SceneSeeker seeker(ChatTuningProperties tuning) {
        return seeker(tuning, SceneSearchProperties.Mode.FALLBACK);
    }

    private SceneSeeker seeker(ChatTuningProperties tuning, SceneSearchProperties.Mode mode) {
        return new SceneSeeker(reader, new KeywordSceneScorer(tuning), selector, verifier, rateLimiter, tuning,
                meterRegistry, gmsProperties, vectorSearch,
                new SceneSearchProperties(null, new SceneSearchProperties.Search(mode, null, null), null));
    }

    private static List<SceneText> talky(String first, String second) {
        return List.of(new SceneText(1L, 1, 0, 600_000, "1회", "", List.of(), "", List.of(
                new Moment(95_000, MomentType.DIALOGUE, first), new Moment(300_000, MomentType.DIALOGUE, second))));
    }
}
