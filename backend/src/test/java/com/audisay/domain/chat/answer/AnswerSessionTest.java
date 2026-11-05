package com.audisay.domain.chat.answer;

import com.audisay.domain.chat.dto.response.AnswerStreamEvent.Sentence;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Duration;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

class AnswerSessionTest {
    private final ExecutorService tts = Executors.newSingleThreadExecutor();
    private final AnswerSink sink = mock(AnswerSink.class);

    @AfterEach
    void tearDown() {
        tts.shutdownNow();
    }

    @Test
    void 음성이_늦으면_남은_문장을_음성_없이_보내고_늦게_끝난_음성은_보내지_않는다() throws Exception {
        CountDownLatch release = new CountDownLatch(1);
        // 둘째 문장은 이미 음성 없이 보냈으므로 TTS를 부르지 않는다(첫 문장만 기다림)
        CountDownLatch finished = new CountDownLatch(1);
        AnswerSession session = new AnswerSession(sink, sentence -> {
            try {
                release.await(5, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            finished.countDown();
            return "audio:" + sentence;
        }, tts, System.nanoTime());

        session.speak(List.of("첫 문장이에요.", "둘째 문장이에요."));
        session.awaitSpeech(Duration.ofMillis(50));
        release.countDown();
        finished.await(5, TimeUnit.SECONDS);
        tts.shutdown();
        tts.awaitTermination(5, TimeUnit.SECONDS);

        ArgumentCaptor<Object> sent = ArgumentCaptor.forClass(Object.class);
        verify(sink, times(2)).send(eq("sentence"), sent.capture());
        assertThat(sent.getAllValues()).containsExactly(new Sentence("첫 문장이에요.", null),
                new Sentence("둘째 문장이에요.", null));
    }

    @Test
    void 음성이_제때_끝나면_음성_주소와_함께_한_번씩만_보낸다() {
        AnswerSession session = new AnswerSession(sink, sentence -> "audio:" + sentence, tts, System.nanoTime());

        session.speak(List.of("첫 문장이에요.", "둘째 문장이에요."));
        session.awaitSpeech(Duration.ofSeconds(5));

        ArgumentCaptor<Object> sent = ArgumentCaptor.forClass(Object.class);
        verify(sink, times(2)).send(eq("sentence"), sent.capture());
        assertThat(sent.getAllValues()).containsExactly(new Sentence("첫 문장이에요.", "audio:첫 문장이에요."),
                new Sentence("둘째 문장이에요.", "audio:둘째 문장이에요."));
        assertThat(session.firstAudioMs()).isNotNull();
    }
}
