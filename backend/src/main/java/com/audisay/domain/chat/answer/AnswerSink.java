package com.audisay.domain.chat.answer;

import com.audisay.domain.chat.dto.response.AnswerStreamEvent.Failed;
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
    /** done/error를 이미 보냈는지(그 뒤 시간 초과가 와도 error를 또 보내지 않게) */
    private volatile boolean terminated;

    public AnswerSink(SseEmitter emitter) {
        this.emitter = emitter;
        emitter.onCompletion(() -> closed = true);
        emitter.onTimeout(this::timeout);
        emitter.onError(e -> closed = true);
    }

    /** SSE 최대 시간이 지났다: done 없이 끊기지 않게 error(AI_TIMEOUT)를 보내고 닫는다 */
    synchronized void timeout() {
        if (!closed && !terminated) {
            try {
                emitter.send(SseEmitter.event().name("error")
                        .data(new Failed("AI_TIMEOUT", ChatAnswerService.streamErrorMessage("AI_TIMEOUT"))));
            } catch (IOException | IllegalStateException e) {
                log.debug("답변 SSE 시간 초과 알림 실패(연결 끊김): {}", e.getMessage());
            }
        }
        closed = true;
        emitter.complete();
    }

    public synchronized void send(String name, Object data) {
        if (closed) {
            return;
        }
        if ("done".equals(name) || "error".equals(name)) {
            terminated = true;
        }
        try {
            emitter.send(SseEmitter.event().name(name).data(data));
        } catch (IOException | IllegalStateException e) {
            log.debug("답변 SSE 전송 실패(연결 끊김): {}", e.getMessage());
            closed = true;
        }
    }

    /** SSE 주석 한 줄(": heartbeat"). FE는 받은 바이트로 연결이 살아 있다고 보고 이벤트로는 읽지 않는다 */
    synchronized void heartbeat() {
        if (closed) {
            return;
        }
        try {
            emitter.send(SseEmitter.event().comment("heartbeat"));
        } catch (IOException | IllegalStateException e) {
            log.debug("답변 SSE heartbeat 실패(연결 끊김): {}", e.getMessage());
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
