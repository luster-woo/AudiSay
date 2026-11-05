package com.audisay.global.messaging.outbox;

import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.AmqpConnectException;
import org.springframework.amqp.AmqpException;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executor;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

@Slf4j
@Component
public class OutboxRelay {
    private static final int MAX_ATTEMPTS = 5;
    private static final int BATCH_SIZE = 100;
    private static final Duration CONFIRM_TIMEOUT = Duration.ofSeconds(5);
    private static final String CONFIRM_TIMEOUT_ERROR = "confirm timeout";
    // 커밋 직후 발행이 아직 진행 중일 수 있는 행은 건너뛴다
    private static final Duration RELAY_AFTER = Duration.ofSeconds(10);

    private final RabbitTemplate rabbitTemplate;
    private final OutboxMessageRepository outboxMessageRepository;
    private final TransactionTemplate requiresNewTx;
    /**
     * 발행 확인(confirm)은 RabbitMQ 연결 I/O 스레드에서 온다. 거기서 DB를 기다리면 같은 연결의 소비·heartbeat가 멈추므로
     * 상태 갱신은 이 스레드로 넘긴다. 넘치면 버리고 PENDING으로 남겨 재발행(relayPending)에 맡긴다
     */
    private final Executor confirmExecutor;

    public OutboxRelay(RabbitTemplate rabbitTemplate, OutboxMessageRepository outboxMessageRepository,
                       PlatformTransactionManager transactionManager) {
        this.rabbitTemplate = rabbitTemplate;
        this.outboxMessageRepository = outboxMessageRepository;
        this.requiresNewTx = new TransactionTemplate(transactionManager);
        this.requiresNewTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.confirmExecutor = new ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS, new LinkedBlockingQueue<>(10_000),
                runnable -> {
                    Thread thread = new Thread(runnable, "outbox-confirm");
                    thread.setDaemon(true);
                    return thread;
                },
                (runnable, executor) -> log.warn("outbox 발행 확인 처리 대기열이 가득 차 버림, 재발행에 맡김"));
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void publishAfterCommit(OutboxSavedEvent event) {
        CorrelationData correlation = new CorrelationData(event.messageId().toString());
        try {
            rabbitTemplate.send(event.exchange(), event.routingKey(), toMessage(event.messageId(), event.body()), correlation);
        } catch (RuntimeException e) {
            // 이미 커밋된 뒤라 예외를 던지면 요청이 실패로 보이므로 로그만 남기고 재발행에 맡긴다
            log.warn("outbox {} 발행 실패, 재발행 대기: {}", event.messageId(), e.getMessage());
            return;
        }
        // 커밋된 원래 트랜잭션에 섞이지 않도록 새 트랜잭션에서 상태를 바꾼다
        correlation.getFuture().whenCompleteAsync((confirm, ex) -> {
            try {
                String error = ex != null ? ex.getMessage() : failureReason(correlation);
                requiresNewTx.executeWithoutResult(status -> outboxMessageRepository.findByIdForUpdate(event.outboxId())
                        .ifPresent(message -> apply(message, error)));
            } catch (RuntimeException e) {
                log.warn("outbox {} 상태 갱신 실패, 재발행 대기: {}", event.messageId(), e.getMessage());
            }
        }, confirmExecutor);
    }

    @Scheduled(fixedDelay = 10_000, initialDelay = 10_000)
    @Transactional
    public void relayPending() {
        List<OutboxMessage> messages = outboxMessageRepository.findPendingForRelay(
                Instant.now().minus(RELAY_AFTER), BATCH_SIZE);
        for (OutboxMessage message : messages) {
            try {
                String error = sendAndWait(message);
                apply(message, error);
                if (CONFIRM_TIMEOUT_ERROR.equals(error)) {
                    // 브로커가 느리거나 막혀 있으면(메모리 알람 등) 나머지도 5초씩 기다리게 되어 스케줄러와 DB 트랜잭션을 오래 잡는다
                    log.warn("RabbitMQ 발행 확인이 늦어 outbox 재발행을 다음 주기로 미룸");
                    return;
                }
            } catch (AmqpConnectException e) {
                // 브로커가 꺼져 있으면 나머지도 실패하므로 횟수를 올리지 않고 다음 주기에 다시 시도한다
                log.warn("RabbitMQ 연결 실패, outbox 재발행 중단: {}", e.getMessage());
                return;
            } catch (AmqpException e) {
                apply(message, e.getMessage());
            }
        }
    }

    private String sendAndWait(OutboxMessage message) {
        CorrelationData correlation = new CorrelationData(message.getMessageId().toString());
        rabbitTemplate.send(message.getExchange(), message.getRoutingKey(),
                toMessage(message.getMessageId(), message.getBody()), correlation);
        try {
            correlation.getFuture().get(CONFIRM_TIMEOUT.toMillis(), TimeUnit.MILLISECONDS);
            return failureReason(correlation);
        } catch (TimeoutException e) {
            return CONFIRM_TIMEOUT_ERROR;
        } catch (ExecutionException e) {
            return e.getCause() != null ? e.getCause().getMessage() : e.getMessage();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return "interrupted";
        }
    }

    /** confirm이 끝난 뒤 호출. 성공이면 null */
    private String failureReason(CorrelationData correlation) {
        if (correlation.getReturned() != null) {
            return "unroutable: " + correlation.getReturned().getReplyText();
        }
        CorrelationData.Confirm confirm = correlation.getFuture().getNow(null);
        if (confirm == null || !confirm.ack()) {
            return "nack: " + (confirm == null ? null : confirm.reason());
        }
        return null;
    }

    private void apply(OutboxMessage message, String error) {
        if (error == null) {
            message.markSent();
            return;
        }
        message.recordFailure(error, MAX_ATTEMPTS);
        if (message.getStatus() == OutboxStatus.FAILED) {
            log.error("outbox {} 발행 {}회 실패로 중단 ({} {}): {}", message.getMessageId(), MAX_ATTEMPTS,
                    message.getExchange(), message.getRoutingKey(), error);
        } else {
            log.warn("outbox {} 발행 실패 {}회: {}", message.getMessageId(), message.getAttempts(), error);
        }
    }

    private Message toMessage(UUID messageId, String body) {
        MessageProperties properties = new MessageProperties();
        properties.setContentType(MessageProperties.CONTENT_TYPE_JSON);
        properties.setContentEncoding(StandardCharsets.UTF_8.name());
        properties.setMessageId(messageId.toString());
        properties.setDeliveryMode(MessageDeliveryMode.PERSISTENT);
        return new Message(body.getBytes(StandardCharsets.UTF_8), properties);
    }
}
