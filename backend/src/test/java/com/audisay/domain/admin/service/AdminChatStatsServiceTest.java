package com.audisay.domain.admin.service;

import com.audisay.domain.admin.dto.response.ChatStatsResponse;
import com.audisay.domain.admin.repository.ChatStatsRepository;
import com.audisay.domain.chat.answer.AnswerPrompt;
import com.audisay.global.exception.BusinessException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AdminChatStatsServiceTest {
    private static final LocalDate FROM = LocalDate.of(2026, 11, 1);
    private static final LocalDate TO = LocalDate.of(2026, 11, 3);
    private static final Instant START = Instant.parse("2026-10-31T15:00:00Z");
    private static final Instant END = Instant.parse("2026-11-03T15:00:00Z");

    private ChatStatsRepository repository;
    private AdminChatStatsService service;

    @BeforeEach
    void setUp() {
        repository = mock(ChatStatsRepository.class);
        service = new AdminChatStatsService(repository);
    }

    @Test
    void intent별_입력과_질문_답변_근거_비율을_준다() {
        when(repository.countByIntent(START, END)).thenReturn(List.of(intent("ACTION", 30, 1.0, 3.0),
                intent("QUESTION", 20, 900.4, 1500.6), intent("SEEK_SCENE", 10, 40.0, 1100.0)));
        when(repository.countAnswers(START, END, AnswerPrompt.FUTURE_PROMPT)).thenReturn(List.of(
                answer("QUESTION", "STORED", 12, 0), answer("QUESTION", "UNANSWERABLE", 6, 2),
                answer("QUESTION", "FUTURE", 2, 0), answer("SCENE_NOW", "STORED", 5, 0)));
        when(repository.firstAudioByIntent(START, END)).thenReturn(List.of(latency("QUESTION", 1100.2, 2900.7)));
        when(repository.countSeekSources(START, END)).thenReturn(List.of(seek("KEYWORD", 7), seek("LLM", 2), seek(null, 1)));
        when(repository.findUnanswered(eq(START), eq(END), eq(AnswerPrompt.FUTURE_PROMPT), anyInt()))
                .thenReturn(List.of(unanswered(41L, "이 차 가격이 얼마야?")));

        ChatStatsResponse result = service.getChatStats(FROM, TO);

        assertThat(result.inputs()).isEqualTo(60);
        assertThat(result.byIntent()).extracting("intent", "count", "intentP50Ms")
                .containsExactly(tuple("ACTION", 30L, 1L), tuple("QUESTION", 20L, 900L), tuple("SEEK_SCENE", 10L, 40L));
        ChatStatsResponse.AnswerStat answer = result.answer();
        assertThat(answer.questions()).isEqualTo(20);
        assertThat(answer.notAnsweredDirectly()).isEqualTo(8);
        assertThat(answer.futureOffered()).isEqualTo(4);
        assertThat(answer.futureChosen()).isEqualTo(2);
        assertThat(answer.unanswerableRate()).isEqualTo(8.0 / 20);
        assertThat(answer.futureOfferedRate()).isEqualTo(4.0 / 8);
        assertThat(answer.futureChosenRate()).isEqualTo(2.0 / 4);
        assertThat(answer.byIntent()).extracting("intent", "answered", "stored", "unanswerable", "future", "firstAudioP95Ms")
                .containsExactly(tuple("QUESTION", 20L, 12L, 6L, 2L, 2901L), tuple("SCENE_NOW", 5L, 5L, 0L, 0L, null));
        assertThat(result.seek()).isEqualTo(new ChatStatsResponse.SeekStat(10, 7, 2, 1, 0.7));
        assertThat(result.recentUnanswered()).extracting("chatLogId", "utterance").containsExactly(tuple(41L, "이 차 가격이 얼마야?"));
    }

    @Test
    void 기록이_없으면_0과_빈_목록() {
        ChatStatsResponse result = service.getChatStats(FROM, TO);

        assertThat(result.inputs()).isZero();
        assertThat(result.answer().unanswerableRate()).isZero();
        assertThat(result.answer().byIntent()).isEmpty();
        assertThat(result.seek().keywordRate()).isZero();
    }

    @Test
    void 기간이_거꾸로거나_92일을_넘으면_COMMON_001() {
        assertThatThrownBy(() -> service.getChatStats(TO, FROM)).isInstanceOf(BusinessException.class)
                .hasMessage("시작일이 종료일보다 늦어요.");
        assertThatThrownBy(() -> service.getChatStats(FROM, FROM.plusDays(92))).isInstanceOf(BusinessException.class);
    }

    private static ChatStatsRepository.IntentRow intent(String intent, long count, Double p50, Double p95) {
        return new ChatStatsRepository.IntentRow() {
            public String getIntent() { return intent; }
            public Long getCount() { return count; }
            public Double getP50() { return p50; }
            public Double getP95() { return p95; }
        };
    }

    private static ChatStatsRepository.AnswerRow answer(String intent, String source, long count, long offered) {
        return new ChatStatsRepository.AnswerRow() {
            public String getIntent() { return intent; }
            public String getAnswerSource() { return source; }
            public Long getCount() { return count; }
            public Long getFutureOffered() { return offered; }
        };
    }

    private static ChatStatsRepository.LatencyRow latency(String intent, Double p50, Double p95) {
        return new ChatStatsRepository.LatencyRow() {
            public String getIntent() { return intent; }
            public Double getP50() { return p50; }
            public Double getP95() { return p95; }
        };
    }

    private static ChatStatsRepository.SeekRow seek(String source, long count) {
        return new ChatStatsRepository.SeekRow() {
            public String getSeekSource() { return source; }
            public Long getCount() { return count; }
        };
    }

    private static ChatStatsRepository.UnansweredRow unanswered(Long id, String utterance) {
        return new ChatStatsRepository.UnansweredRow() {
            public Long getChatLogId() { return id; }
            public Long getVideoId() { return 2L; }
            public String getVideoTitle() { return "테슬라"; }
            public Integer getVideoTimeMs() { return 250_000; }
            public String getUtterance() { return utterance; }
            public String getCreatedAt() { return "2026-11-04 14:00"; }
        };
    }
}
