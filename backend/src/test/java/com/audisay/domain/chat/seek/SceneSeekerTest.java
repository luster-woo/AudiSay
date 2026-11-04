package com.audisay.domain.chat.seek;

import com.audisay.domain.chat.entity.SeekSource;
import com.audisay.domain.chat.ratelimit.ChatRateLimiter;
import com.audisay.domain.chat.tuning.ChatTuningProperties;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import com.audisay.domain.chat.seek.KeywordSceneScorer.Hit;
import com.audisay.domain.description.service.SceneText;
import com.audisay.domain.description.service.SceneText.Moment;
import com.audisay.domain.description.service.SceneText.MomentType;
import com.audisay.domain.description.service.SceneTextReader;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
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
    private SceneSeeker seeker;

    @BeforeEach
    void setUp() {
        reader = mock(SceneTextReader.class);
        selector = mock(LlmSceneSelector.class);
        verifier = mock(LlmHitVerifier.class);
        rateLimiter = mock(ChatRateLimiter.class);
        meterRegistry = new SimpleMeterRegistry();
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

    private SceneSeeker seeker(ChatTuningProperties tuning) {
        return new SceneSeeker(reader, new KeywordSceneScorer(tuning), selector, verifier, rateLimiter, tuning,
                meterRegistry);
    }

    private static List<SceneText> talky(String first, String second) {
        return List.of(new SceneText(1L, 1, 0, 600_000, "1회", "", List.of(), "", List.of(
                new Moment(95_000, MomentType.DIALOGUE, first), new Moment(300_000, MomentType.DIALOGUE, second))));
    }
}
