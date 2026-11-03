package com.audisay.domain.chat.answer;

import lombok.extern.slf4j.Slf4j;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;

/**
 * 답변 SSE 하나. LLM 스레드(delta)와 음성 스레드(sentence)가 함께 보내므로 보내기는 한 번에 하나씩.
 * 연결이 끊기면 closed → LLM 스트림·남은 음성을 멈춘다
 */
@Slf4j
public class AnswerSink {
    private final SseEmitter emitter;
    private volatile boolean closed;

    public AnswerSink(SseEmitter emitter) {
        this.emitter = emitter;
        emitter.onCompletion(() -> closed = true);
        emitter.onTimeout(() -> {
            closed = true;
            emitter.complete();
        });
        emitter.onError(e -> closed = true);
    }

    public synchronized void send(String name, Object data) {
        if (closed) {
            return;
        }
        try {
            emitter.send(SseEmitter.event().name(name).data(data));
        } catch (IOException | IllegalStateException e) {
            log.debug("답변 SSE 전송 실패(연결 끊김): {}", e.getMessage());
            closed = true;
        }
    }

    public synchronized void complete() {
        if (!closed) {
            closed = true;
            emitter.complete();
        }
    }

    public boolean isClosed() {
        return closed;
    }
}
