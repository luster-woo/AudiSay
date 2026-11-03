package com.audisay.domain.chat.seek;

import com.audisay.domain.chat.seek.KeywordSceneScorer.Hit;
import com.audisay.domain.description.service.SceneText;
import com.audisay.domain.description.service.SceneText.Moment;
import com.audisay.domain.description.service.SceneText.MomentType;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
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
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class LlmSceneSelectorTest {
    private final List<SceneText> game = List.of(
            chapter(1, 0, 600_000, "1회 초 두산 공격", "두산 타자들이 타석에 들어섭니다.",
                    narration(97_000, "타자가 공을 쳐서 1루로 달려갑니다")),
            chapter(2, 600_000, 1_200_000, "1회 말 LG 공격", "LG 타자들이 공격합니다.",
                    narration(905_000, "1루 주자가 2루로 달려 세이프"), dialogue(1_000_000, "볼넷입니다")),
            chapter(3, 1_200_000, 1_800_000, "2회 초", "타자가 공을 멀리 칩니다.",
                    narration(1_500_000, "타자가 친 공이 외야로 굴러가고 타자는 1루에 섭니다")));

    private LlmClient llmClient;
    private LlmSceneSelector selector;

    @BeforeEach
    void setUp() {
        llmClient = mock(LlmClient.class);
        selector = new LlmSceneSelector(llmClient, JsonMapper.builder().build(), new KeywordSceneScorer());
    }

    @Test
    void 목차와_발췌를_보내고_챗봇_기록에_연결한다() {
        answer("{\"n\":[2]}");

        selector.select("도루하는 장면", game, 31L, 0);

        ArgumentCaptor<LlmRequest> captor = ArgumentCaptor.forClass(LlmRequest.class);
        verify(llmClient).generate(captor.capture());
        LlmRequest request = captor.getValue();
        assertThat(request.purpose()).isEqualTo(LlmPurpose.SEEK);
        assertThat(request.jsonOutput()).isTrue();
        assertThat(request.chatLogId()).isEqualTo(31L);
        assertThat(request.user())
                .contains("2. 10:00 1회 말 LG 공격 / LG 타자들이 공격합니다. / 발췌: 1루 주자가 2루로 달려 세이프")
                .endsWith("사용자 요청: 도루하는 장면");
    }

    @Test
    void 고른_장면_안에서_검색어와_겹치는_문장_시각으로_간다() {
        answer("{\"n\":[2]}");

        List<Hit> hits = selector.select("2루로 달리는 장면", game, 1L, 0);

        assertThat(hits).extracting(Hit::targetMs).containsExactly(903_000);
    }

    @Test
    void 겹치는_문장이_없으면_목차_시작으로_간다() {
        answer("{\"n\":[2]}");

        assertThat(selector.select("도루하는 장면", game, 1L, 0)).extracting(Hit::targetMs).containsExactly(600_000);
    }

    @Test
    void 여러_장면을_고르면_지금_이후부터_시간순() {
        answer("{\"n\":[3, 1]}");

        List<Hit> hits = selector.select("안타 친 장면", game, 1L, 1_000_000);

        assertThat(hits).extracting(h -> h.scene().chapterIndex()).containsExactly(3, 1);
    }

    @Test
    void 범위_밖_중복_번호는_뺀다() {
        answer("```json\n{\"n\":[0, 9, \"2\", 2]}\n```");

        assertThat(selector.select("장면", game, 1L, 0)).extracting(h -> h.scene().chapterIndex()).containsExactly(2);
    }

    @Test
    void 없다고_하거나_읽을_수_없으면_빈_목록() {
        answer("{\"n\":[]}");
        assertThat(selector.select("딸기", game, 1L, 0)).isEmpty();

        answer("찾지 못했어요");
        assertThat(selector.select("딸기", game, 1L, 0)).isEmpty();
    }

    @Test
    void 안전_정책_거부는_빈_목록_한도_초과는_CHAT_007() {
        when(llmClient.generate(any()))
                .thenThrow(new LlmException(LlmException.Kind.BLOCKED, 200, "blocked", null))
                .thenThrow(new LlmException(LlmException.Kind.RATE_LIMIT, 429, "limit", null));

        assertThat(selector.select("장면", game, 1L, 0)).isEmpty();
        assertThatThrownBy(() -> selector.select("장면", game, 1L, 0))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode").isEqualTo(ErrorCode.CHAT_AI_LIMIT);
    }

    private void answer(String text) {
        when(llmClient.generate(any())).thenReturn(new LlmResult(text, "gemini-3.1-flash-lite", 900, 10, 700, false, 5L));
    }

    private static SceneText chapter(int n, int startMs, int endMs, String title, String summary, Moment... moments) {
        return new SceneText((long) n, n, startMs, endMs, title, summary, List.of(), "", List.of(moments));
    }

    private static Moment narration(int ms, String text) {
        return new Moment(ms, MomentType.NARRATION, text);
    }

    private static Moment dialogue(int ms, String text) {
        return new Moment(ms, MomentType.DIALOGUE, text);
    }
}
