package com.audisay.domain.chat.seek;

import com.audisay.domain.chat.seek.KeywordSceneScorer.Hit;
import com.audisay.domain.description.service.SceneText;
import com.audisay.domain.description.service.SceneText.Moment;
import com.audisay.domain.description.service.SceneText.MomentType;
import com.audisay.global.external.llm.LlmClient;
import com.audisay.global.external.llm.LlmException;
import com.audisay.global.external.llm.LlmPurpose;
import com.audisay.global.external.llm.LlmRequest;
import com.audisay.global.external.llm.LlmResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class LlmHitVerifierTest {
    private final Moment hit1 = new Moment(95_000, MomentType.DIALOGUE, "쳤습니다! 중견수 앞 안타!");
    private final Moment hit2 = new Moment(480_000, MomentType.DIALOGUE, "오늘 안타는 무슨, 삼진이죠");
    private final SceneText scene = new SceneText(1L, 1, 0, 600_000, "1회 초", "", List.of(), "", List.of(
            new Moment(88_000, MomentType.DIALOGUE, "1번 타자 타석에 들어섭니다"), hit1,
            new Moment(99_000, MomentType.NARRATION, "타자가 1루로 달려갑니다"), hit2));
    private final List<Hit> hits = List.of(
            new Hit(scene, 93_000, 1, 1, hit1, hit1.text(), 1),
            new Hit(scene, 478_000, 1, 1, hit2, hit2.text(), 1));

    private LlmClient llmClient;
    private LlmHitVerifier verifier;

    @BeforeEach
    void setUp() {
        llmClient = mock(LlmClient.class);
        verifier = new LlmHitVerifier(llmClient, JsonMapper.builder().build());
    }

    @Test
    void 후보마다_앞뒤_문장을_붙여_묻고_일어난_것만_남긴다() {
        answer("{\"ok\":[1]}");

        List<Hit> verified = verifier.verify("안타 친 장면", hits, 31L);

        assertThat(verified).extracting(Hit::targetMs).containsExactly(93_000);
        ArgumentCaptor<LlmRequest> captor = ArgumentCaptor.forClass(LlmRequest.class);
        verify(llmClient).generate(captor.capture());
        assertThat(captor.getValue().purpose()).isEqualTo(LlmPurpose.SEEK);
        assertThat(captor.getValue().chatLogId()).isEqualTo(31L);
        assertThat(captor.getValue().user())
                .startsWith("요청: 안타 친 장면")
                .contains("1. 1:33 대사 \"쳤습니다! 중견수 앞 안타!\" (앞: 1번 타자 타석에 들어섭니다 / 뒤: 타자가 1루로 달려갑니다)")
                .contains("2. 7:58 대사 \"오늘 안타는 무슨, 삼진이죠\"");
    }

    @Test
    void 하나도_아니라고_하면_빈_목록() {
        answer("{\"ok\":[]}");

        assertThat(verifier.verify("안타 친 장면", hits, 31L)).isEmpty();
    }

    @Test
    void LLM이_실패하거나_읽을_수_없으면_후보를_그대로_둔다() {
        when(llmClient.generate(any()))
                .thenThrow(new LlmException(LlmException.Kind.TIMEOUT, 0, "slow", null))
                .thenReturn(new LlmResult("잘 모르겠어요", "gemini-3.1-flash-lite", 300, 5, 600, false, 9L));

        assertThat(verifier.verify("안타 친 장면", hits, 31L)).isEqualTo(hits);
        assertThat(verifier.verify("안타 친 장면", hits, 31L)).isEqualTo(hits);
    }

    @Test
    void 대사_한_줄에서만_찾은_후보가_있을_때만_거를_만하다() {
        Hit corroborated = new Hit(scene, 93_000, 1, 1, hit1, hit1.text(), 2);

        assertThat(LlmHitVerifier.worthVerifying(hits)).isTrue();
        assertThat(LlmHitVerifier.worthVerifying(List.of(corroborated, corroborated))).isFalse();
        assertThat(LlmHitVerifier.worthVerifying(List.of(hits.get(0)))).isFalse();
    }

    private void answer(String text) {
        when(llmClient.generate(any())).thenReturn(new LlmResult(text, "gemini-3.1-flash-lite", 300, 5, 600, false, 9L));
    }
}
