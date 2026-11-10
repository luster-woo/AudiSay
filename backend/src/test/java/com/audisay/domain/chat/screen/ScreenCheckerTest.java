package com.audisay.domain.chat.screen;

import com.audisay.domain.chat.screen.ScreenAnswerJudge.Verdict;
import com.audisay.domain.chat.screen.ScreenVideoClient.Answer;
import com.audisay.domain.video.entity.SourceType;
import com.audisay.domain.video.entity.Video;
import com.audisay.domain.video.repository.VideoRepository;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ScreenCheckerTest {
    private static final String CHEAP = "cheap";
    private static final String MAIN = "main";
    private static final String TIE = "tie";
    private static final String URL = "https://www.youtube.com/watch?v=abc";

    private final ScreenVideoClient client = mock(ScreenVideoClient.class);
    private final VideoRepository videoRepository = mock(VideoRepository.class);
    private final ScreenChecker checker = new ScreenChecker(
            new ScreenCheckProperties(true, 15, CHEAP, MAIN, TIE, Duration.ofSeconds(8), 200), client, videoRepository,
            new SimpleMeterRegistry());

    @AfterEach
    void tearDown() {
        checker.shutdown();
    }

    @Test
    void 숫자가_없는_질문은_싼_모델_하나로_끝낸다() {
        answer(CHEAP, "트랙터는 파란색이에요.");

        Verdict verdict = checker.check(URL, 140_000, "트랙터 무슨 색이야?", 1L).orElseThrow();

        assertThat(verdict.text()).isEqualTo("트랙터는 파란색이에요.");
        assertThat(verdict.answered()).isTrue();
        verify(client, never()).ask(eq(MAIN), anyString(), anyInt(), anyInt(), anyString(), anyString(), any());
    }

    @Test
    void 구간은_질문한_시각_앞_windowSec초() {
        answer(CHEAP, "냄비는 검은색이에요.");

        checker.check(URL, 90_500, "냄비 무슨 색이야?", 1L);

        verify(client).ask(eq(CHEAP), eq(URL), eq(75), eq(90), anyString(), eq("냄비 무슨 색이야?"), eq(1L));
    }

    @Test
    void 숫자_질문은_두_모델이_같으면_주_모델_답() {
        answer(CHEAP, "쌀은 2컵이에요.");
        answer(MAIN, "쌀은 2컵을 넣어요.");

        Verdict verdict = checker.check(URL, 26_000, "쌀은 몇 컵 넣어?", 1L).orElseThrow();

        assertThat(verdict.text()).isEqualTo("쌀은 2컵을 넣어요.");
        verify(client, never()).ask(eq(TIE), anyString(), anyInt(), anyInt(), anyString(), anyString(), any());
    }

    @Test
    void 숫자가_다르면_셋째_모델로_다수결() {
        answer(CHEAP, "킬 스코어는 0 대 3이에요.");
        answer(MAIN, "킬 스코어는 0 대 0이에요.");
        answer(TIE, "킬 스코어는 0 대 3이에요.");

        assertThat(checker.check(URL, 165_000, "지금 킬 스코어 몇 대 몇이야?", 1L).orElseThrow().text())
                .isEqualTo("킬 스코어는 0 대 3이에요.");
    }

    @Test
    void 개수는_세_모델_범위() {
        answer(CHEAP, "두 명이 달려요.");
        answer(MAIN, "2명이 달려요.");
        answer(TIE, "4명이 달려요.");

        assertThat(checker.check(URL, 230_000, "지금 달리는 사람 몇 명이야?", 1L).orElseThrow().text())
                .startsWith("화면에 보이는 것만 세면 2~4명");
    }

    @Test
    void 모두_실패하면_empty() {
        assertThat(checker.check(URL, 30_000, "쌀은 몇 컵 넣어?", 1L)).isEmpty();
    }

    @Test
    void 유튜브_영상만_주소를_준다() {
        Video youtube = mock(Video.class);
        when(youtube.getSourceType()).thenReturn(SourceType.YOUTUBE);
        when(youtube.getYoutubeVideoId()).thenReturn("abc");
        Video upload = mock(Video.class);
        when(upload.getSourceType()).thenReturn(SourceType.UPLOAD);
        when(videoRepository.findById(1L)).thenReturn(Optional.of(youtube));
        when(videoRepository.findById(2L)).thenReturn(Optional.of(upload));

        assertThat(checker.youtubeUrl(1L)).contains(URL);
        assertThat(checker.youtubeUrl(2L)).isEmpty();
        assertThat(checker.youtubeUrl(null)).isEmpty();
    }

    @Test
    void 꺼져_있으면_주소를_주지_않는다() {
        ScreenChecker off = new ScreenChecker(new ScreenCheckProperties(false, null, null, null, null, null, null),
                client, videoRepository, new SimpleMeterRegistry());
        assertThat(off.youtubeUrl(1L)).isEmpty();
        off.shutdown();
    }

    private void answer(String model, String text) {
        when(client.ask(eq(model), anyString(), anyInt(), anyInt(), anyString(), anyString(), any()))
                .thenReturn(new Answer(text, model, 100));
    }
}
