package com.audisay.domain.job.service;

import com.audisay.domain.job.message.JobMessage;
import com.audisay.domain.job.message.MessageType;
import com.audisay.global.config.RabbitConfig;
import com.audisay.global.messaging.outbox.OutboxPublisher;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

import java.util.UUID;

@Service
@RequiredArgsConstructor
public class JobMessagePublisher {
    private final OutboxPublisher outboxPublisher;
    private final ObjectMapper objectMapper;

    /**
     * 워커에게 보낼 메시지를 등록한다. job 저장과 같은 @Transactional 안에서 호출해야 하며,
     * 실제 발행은 커밋 후 자동으로 된다. line.tts처럼 작업이 없는 메시지는 jobId에 null.
     */
    public UUID publish(Long jobId, MessageType type, Object payload) {
        JobMessage message = JobMessage.of(type, jobId, payload);
        outboxPublisher.save(message.messageId(), RabbitConfig.JOB_EXCHANGE, type.getRoutingKey(),
                objectMapper.writeValueAsString(message));
        return message.messageId();
    }
}
