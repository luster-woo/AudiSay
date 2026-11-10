package com.audisay.domain.job.service;

import com.audisay.domain.job.message.MessageType;
import com.audisay.domain.job.message.payload.PreparePayload;
import com.audisay.global.config.RabbitConfig;
import com.audisay.global.messaging.outbox.OutboxMessage;
import com.audisay.global.messaging.outbox.OutboxMessageRepository;
import com.audisay.global.messaging.outbox.OutboxStatus;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.AmqpAdmin;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 로컬 Docker의 Postgres·RabbitMQ에 붙어서 실행한다. 로컬 AI 워커는 꺼 둘 것(job.prepare를 먼저 가져감).
 */
@SpringBootTest
class JobMessagePublisherTest {

    @Autowired
    JobMessagePublisher publisher;
    @Autowired
    OutboxMessageRepository outboxRepository;
    @Autowired
    RabbitTemplate rabbitTemplate;
    @Autowired
    AmqpAdmin amqpAdmin;
    @Autowired
    TransactionTemplate tx;
    @Autowired
    ObjectMapper objectMapper;

    private final PreparePayload payload = PreparePayload.youtube(9001L, "https://youtu.be/test", 300, "테스트 영상");

    @BeforeEach
    @AfterEach
    void purgeQueue() {
        amqpAdmin.purgeQueue(RabbitConfig.PREPARE_QUEUE, false);
    }

    @Test
    @SuppressWarnings("unchecked")
    void 커밋되면_발행되고_SENT가_된다() throws Exception {
        UUID messageId = tx.execute(s -> publisher.publish(9001L, MessageType.JOB_PREPARE, payload));

        OutboxMessage saved = waitForStatus(messageId, OutboxStatus.SENT);
        assertThat(saved.getSentAt()).isNotNull();

        Message received = rabbitTemplate.receive(RabbitConfig.PREPARE_QUEUE, 5_000);
        assertThat(received).isNotNull();
        assertThat(received.getMessageProperties().getMessageId()).isEqualTo(messageId.toString());

        Map<String, Object> body = objectMapper.readValue(
                new String(received.getBody(), StandardCharsets.UTF_8), new TypeReference<>() {});
        assertThat(body).containsEntry("messageId", messageId.toString())
                .containsEntry("type", "JOB_PREPARE")
                .containsEntry("jobId", 9001)
                .containsEntry("attempt", 1)
                .containsKeys("createdAt", "lastError");
        assertThat((Map<String, Object>) body.get("payload"))
                .containsEntry("videoId", 9001)
                .containsEntry("pipeline", "GEMINI_URL")
                .containsEntry("youtubeUrl", "https://youtu.be/test")
                .containsEntry("durationSec", 300)
                .containsEntry("chunkSec", 120)
                .containsEntry("skipCache", false);

        outboxRepository.delete(saved);
    }

    @Test
    void 롤백되면_outbox도_메시지도_없다() {
        UUID messageId = tx.execute(s -> {
            UUID id = publisher.publish(9001L, MessageType.JOB_PREPARE, payload);
            s.setRollbackOnly();
            return id;
        });

        assertThat(findByMessageId(messageId)).isNull();
        assertThat(rabbitTemplate.receive(RabbitConfig.PREPARE_QUEUE, 2_000)).isNull();
    }

    @Test
    void 트랜잭션_밖에서_부르면_예외() {
        assertThatThrownBy(() -> publisher.publish(9001L, MessageType.JOB_PREPARE, payload))
                .isInstanceOf(IllegalTransactionStateException.class);
    }

    private OutboxMessage waitForStatus(UUID messageId, OutboxStatus status) throws InterruptedException {
        for (int i = 0; i < 50; i++) {
            OutboxMessage message = findByMessageId(messageId);
            if (message != null && message.getStatus() == status) {
                return message;
            }
            Thread.sleep(100);
        }
        throw new AssertionError("5초 안에 " + status + "가 되지 않음: " + findByMessageId(messageId));
    }

    private OutboxMessage findByMessageId(UUID messageId) {
        return outboxRepository.findAll().stream()
                .filter(message -> message.getMessageId().equals(messageId))
                .findFirst()
                .orElse(null);
    }
}
