package com.audisay.domain.chat.answer;

import com.audisay.domain.chat.dto.response.AnswerStreamEvent.Delta;
import com.audisay.domain.chat.dto.response.AnswerStreamEvent.Sentence;
import lombok.extern.slf4j.Slf4j;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.function.Function;

/**
 * 답변 하나를 만드는 동안의 상태. 글자 조각은 바로 delta로, 문장이 끝나면 음성을 만들어 sentence로 보낸다.
 * 음성은 문장 순서대로 하나씩(앞 문장 음성이 끝나야 다음) 만들어 LLM 스트리밍과 동시에 진행한다.
 * holdFirstSentence면 첫 문장이 끝날 때까지 글자 조각을 잡아 두고, 첫 문장이 "자료에 없어요"면 보내지 않는다
 * (그 대신 "지금 이후에 나와요, 들으시겠어요?" 또는 "자료에 없어요"를 서비스가 읽는다). 음성은 어차피 문장이 끝나야 만들어서 첫 음성은 늦어지지 않는다
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
    private final List<String> heldDeltas = new ArrayList<>();
    private boolean holding;
    private boolean suppressed;

    /** @param speech 문장 → 음성 주소(못 만들면 null) */
    AnswerSession(AnswerSink sink, Function<String, String> speech, Executor ttsExecutor, long startedAt) {
        this(sink, speech, ttsExecutor, startedAt, false);
    }

    AnswerSession(AnswerSink sink, Function<String, String> speech, Executor ttsExecutor, long startedAt,
                  boolean holdFirstSentence) {
        this.holding = holdFirstSentence;
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
            if (suppressed) {
                return !sink.isClosed();
            }
            if (holding) {
                generated = true;
                heldDeltas.add(delta);
                List<String> sentences = splitter.add(delta);
                if (!sentences.isEmpty()) {
                    decideHeld(sentences);
                }
                return !sink.isClosed();
            }
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
        Optional<String> last = splitter.flush();
        if (holding) {
            if (last.isPresent()) {
                decideHeld(List.of(last.get()));
            } else {
                holding = false;
            }
            return;
        }
        if (!suppressed) {
            last.ifPresent(this::enqueue);
        }
    }

    /** 첫 문장이 "자료에 없어요"였으면 true(그 답은 보내지 않았다) */
    synchronized boolean suppressedUnanswerable() {
        return suppressed;
    }

    /** 첫 문장이 끝났다: "자료에 없어요"면 버리고, 아니면 잡아 둔 조각을 그대로 보내고 이어 간다 */
    private void decideHeld(List<String> sentences) {
        holding = false;
        if (AnswerPrompt.saidUnanswerable(sentences.get(0))) {
            suppressed = true;
            heldDeltas.clear();
            return;
        }
        separate();
        for (String held : heldDeltas) {
            text.append(held);
            sink.send("delta", new Delta(held));
        }
        heldDeltas.clear();
        sentences.forEach(this::enqueue);
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
