package com.audisay.domain.chat.answer;

import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.util.concurrent.BlockingQueue;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 답변 전용 스레드. Executor 빈으로 등록하면 Spring Boot 기본 applicationTaskExecutor가 빠지므로 빈 안에 둔다.
 * 답변은 대기열 없이 threads개까지(넘으면 거절 → CHAT_005), 문장 음성은 대기열에 쌓아 순서대로
 */
@Component
public class ChatAnswerExecutors {
    private final Executor answer;
    private final Executor tts;

    @Autowired
    public ChatAnswerExecutors(ChatAnswerProperties properties) {
        this(pool("chat-answer-", properties.threads(), new SynchronousQueue<>()),
                pool("chat-tts-", properties.ttsThreads(), new LinkedBlockingQueue<>(500)));
    }

    ChatAnswerExecutors(Executor answer, Executor tts) {
        this.answer = answer;
        this.tts = tts;
    }

    public Executor answer() {
        return answer;
    }

    public Executor tts() {
        return tts;
    }

    @PreDestroy
    void shutdown() {
        for (Executor executor : new Executor[]{answer, tts}) {
            if (executor instanceof ExecutorService service) {
                service.shutdownNow();
            }
        }
    }

    private static ThreadPoolExecutor pool(String prefix, int size, BlockingQueue<Runnable> queue) {
        AtomicInteger count = new AtomicInteger();
        boolean bounded = queue instanceof SynchronousQueue;
        ThreadPoolExecutor executor = new ThreadPoolExecutor(bounded ? 0 : size, size, 60, TimeUnit.SECONDS, queue,
                runnable -> {
                    Thread thread = new Thread(runnable, prefix + count.incrementAndGet());
                    thread.setDaemon(true);
                    return thread;
                });
        executor.allowCoreThreadTimeOut(true);
        return executor;
    }
}
