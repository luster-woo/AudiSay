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
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

@Slf4j
@Component
public class OutboxRelay {
    private static final int MAX_ATTEMPTS = 5;
    private static final int BATCH_SIZE = 100;
    private static final Duration CONFIRM_TIMEOUT = Duration.ofSeconds(5);
    // 커밋 직후 발행이 아직 진행 중일 수 있는 행은 건너뛴다
    private static final Duration RELAY_AFTER = Duration.ofSeconds(10);

    private final RabbitTemplate rabbitTemplate;
    private final OutboxMessageRepository outboxMessageRepository;
    private final TransactionTemplate requiresNewTx;

    public OutboxRelay(RabbitTemplate rabbitTemplate, OutboxMessageRepository outboxMessageRepository,
                       PlatformTransactionManager transactionManager) {
        this.rabbitTemplate = rabbitTemplate;
        this.outboxMessageRepository = outboxMessageRepository;
        this.requiresNewTx = new TransactionTemplate(transactionManager);
        this.requiresNewTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
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
        correlation.getFuture().whenComplete((confirm, ex) -> {
            try {
                String error = ex != null ? ex.getMessage() : failureReason(correlation);
                requiresNewTx.executeWithoutResult(status -> outboxMessageRepository.findById(event.outboxId())
                        .ifPresent(message -> apply(message, error)));
            } catch (RuntimeException e) {
                log.warn("outbox {} 상태 갱신 실패, 재발행 대기: {}", event.messageId(), e.getMessage());
            }
        });
    }

    @Scheduled(fixedDelay = 10_000, initialDelay = 10_000)
    @Transactional
    public void relayPending() {
        List<OutboxMessage> messages = outboxMessageRepository.findPendingForRelay(
                Instant.now().minus(RELAY_AFTER), BATCH_SIZE);
        for (OutboxMessage message : messages) {
            try {
                apply(message, sendAndWait(message));
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
            return "confirm timeout";
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
        if (confirm == null || !confirm.isAck()) {
            return "nack: " + (confirm == null ? null : confirm.getReason());
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
