package com.audisay.global.messaging.outbox;

import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Component
@RequiredArgsConstructor
public class OutboxPublisher {
    private final OutboxMessageRepository outboxMessageRepository;
    private final ApplicationEventPublisher eventPublisher;

    /**
     * 호출한 쪽 트랜잭션에 outbox 행을 같이 저장한다. 실제 발행은 커밋 후 OutboxRelay가 한다.
     * 업무 데이터와 원자적으로 묶여야 하므로 트랜잭션 밖에서 부르면 예외가 난다(MANDATORY).
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void save(UUID messageId, String exchange, String routingKey, String body) {
        OutboxMessage message = outboxMessageRepository.save(OutboxMessage.create(messageId, exchange, routingKey, body));
        eventPublisher.publishEvent(new OutboxSavedEvent(message.getId(), messageId, exchange, routingKey, body));
    }
}
