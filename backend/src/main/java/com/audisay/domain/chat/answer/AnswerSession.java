package com.audisay.domain.chat.answer;

import com.audisay.domain.chat.dto.response.AnswerStreamEvent.Delta;
import com.audisay.domain.chat.dto.response.AnswerStreamEvent.Sentence;
import lombok.extern.slf4j.Slf4j;

import java.time.Duration;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.function.Function;

/**
 * 답변 하나를 만드는 동안의 상태. 글자 조각은 바로 delta로, 문장이 끝나면 음성을 만들어 sentence로 보낸다.
 * 음성은 문장 순서대로 하나씩(앞 문장 음성이 끝나야 다음) 만들어 LLM 스트리밍과 동시에 진행한다
 */
@Slf4j
final class AnswerSession {
    private final AnswerSink sink;
    private final Function<String, String> speech;
    private final Executor ttsExecutor;
    private final long startedAt;
    private final SentenceSplitter splitter = new SentenceSplitter();
    private final StringBuilder text = new StringBuilder();
    private CompletableFuture<Void> speaking = CompletableFuture.completedFuture(null);
    private volatile Integer firstAudioMs;
    private boolean generated;

    /** @param speech 문장 → 음성 주소(못 만들면 null) */
    AnswerSession(AnswerSink sink, Function<String, String> speech, Executor ttsExecutor, long startedAt) {
        this.sink = sink;
        this.speech = speech;
        this.ttsExecutor = ttsExecutor;
        this.startedAt = startedAt;
    }

    /** LLM 글자 조각. false면 연결이 끊겨 스트림을 멈춘다 */
    synchronized boolean onDelta(String delta) {
        if (sink.isClosed()) {
            return false;
        }
        if (!delta.isEmpty()) {
            if (!generated) {
                separate();
            }
            generated = true;
            text.append(delta);
            sink.send("delta", new Delta(delta));
            splitter.add(delta).forEach(this::enqueue);
        }
        return !sink.isClosed();
    }

    /** LLM이 끝난 뒤 남은 글자를 마지막 문장으로 */
    synchronized void flush() {
        splitter.flush().ifPresent(this::enqueue);
    }

    /** 저장 자료 문장(장면 제목, LLM을 못 쓸 때 대신 읽을 문장) */
    synchronized void speak(List<String> sentences) {
        for (String sentence : sentences) {
            separate();
            text.append(sentence);
            sink.send("delta", new Delta(sentence));
            enqueue(sentence);
        }
    }

    /** 남은 문장 음성이 다 나갈 때까지(최대 wait) */
    void awaitSpeech(Duration wait) {
        CompletableFuture<Void> last;
        synchronized (this) {
            last = speaking;
        }
        try {
            last.get(wait.toMillis(), TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            log.warn("[CHAT] 답변 음성이 {} 안에 끝나지 않음", wait);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (Exception e) {
            log.warn("[CHAT] 답변 음성 실패: {}", e.getMessage());
        }
    }

    synchronized String text() {
        return text.toString().strip();
    }

    /** LLM이 한 글자라도 냈는지 */
    boolean generated() {
        return generated;
    }

    boolean cancelled() {
        return sink.isClosed();
    }

    Integer firstAudioMs() {
        return firstAudioMs;
    }

    int elapsedMs() {
        return (int) ((System.nanoTime() - startedAt) / 1_000_000);
    }

    /** 앞에 읽은 문장(장면 제목 등)과 붙지 않게 띄어 쓴다 */
    private void separate() {
        if (!text.isEmpty() && !Character.isWhitespace(text.charAt(text.length() - 1))) {
            text.append(' ');
            sink.send("delta", new Delta(" "));
        }
    }

    private synchronized void enqueue(String sentence) {
        speaking = speaking.thenRunAsync(() -> {
            if (sink.isClosed()) {
                return;
            }
            String audioUrl = null;
            try {
                audioUrl = speech.apply(sentence);
            } catch (RuntimeException e) {
                log.warn("[CHAT] 답변 문장 음성 실패: {}", e.getMessage());
            }
            if (firstAudioMs == null) {
                firstAudioMs = elapsedMs();
            }
            sink.send("sentence", new Sentence(sentence, audioUrl));
        }, ttsExecutor).exceptionally(e -> {
            log.warn("[CHAT] 답변 문장 음성 작업 실패: {}", e.getMessage());
            return null;
        });
    }
}
