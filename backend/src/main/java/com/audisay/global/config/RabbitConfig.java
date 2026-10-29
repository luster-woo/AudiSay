package com.audisay.global.config;

import java.util.ArrayList;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.AmqpException;
import org.springframework.amqp.core.AmqpAdmin;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.Declarable;
import org.springframework.amqp.core.Declarables;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.FanoutExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.rabbit.core.RabbitAdmin;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.event.EventListener;

/**
 * 이름·종류·인자는 ai/app/mq/topology.py와 같아야 한다. 다르면 워커 선언 시 inequivalent arg 에러.
 */
@Slf4j
@Configuration
public class RabbitConfig {

    public static final String JOB_EXCHANGE = "audisay.job";
    public static final String DLX_EXCHANGE = "audisay.dlx";
    public static final String RETRY_10S_EXCHANGE = "audisay.retry.10s";
    public static final String RETRY_30S_EXCHANGE = "audisay.retry.30s";

    public static final String PREPARE_QUEUE = "job.prepare";
    public static final String TRANSCRIBE_QUEUE = "job.transcribe";
    public static final String SCENE_QUEUE = "job.scene";
    public static final String DESCRIBE_QUEUE = "job.describe";
    public static final String MERGE_QUEUE = "job.merge";
    public static final String TTS_QUEUE = "job.tts";
    public static final String LINE_TTS_QUEUE = "line.tts";
    public static final String EVENTS_QUEUE = "job.events";
    public static final String RETRY_10S_QUEUE = "job.retry.10s";
    public static final String RETRY_30S_QUEUE = "job.retry.30s";
    public static final String DLQ = "job.dlq";

    public static final List<String> JOB_EXCHANGE_QUEUES = List.of(
            PREPARE_QUEUE, TRANSCRIBE_QUEUE, SCENE_QUEUE, DESCRIBE_QUEUE,
            MERGE_QUEUE, TTS_QUEUE, LINE_TTS_QUEUE, EVENTS_QUEUE);

    // long이면 AI(signedint)와 타입이 달라 inequivalent arg 에러
    private static final int RETRY_10S_TTL_MS = 10_000;
    private static final int RETRY_30S_TTL_MS = 30_000;
    private static final int DLQ_TTL_MS = 7 * 24 * 3600 * 1000;

    @Bean
    public Declarables jobTopology() {
        List<Declarable> declarables = new ArrayList<>();

        DirectExchange job = new DirectExchange(JOB_EXCHANGE, true, false);
        FanoutExchange dlx = new FanoutExchange(DLX_EXCHANGE, true, false);
        declarables.add(job);
        declarables.add(dlx);

        for (String name : JOB_EXCHANGE_QUEUES) {
            Queue queue = QueueBuilder.durable(name).build();
            declarables.add(queue);
            declarables.add(BindingBuilder.bind(queue).to(job).with(name));
        }

        addRetry(declarables, RETRY_10S_EXCHANGE, RETRY_10S_QUEUE, RETRY_10S_TTL_MS);
        addRetry(declarables, RETRY_30S_EXCHANGE, RETRY_30S_QUEUE, RETRY_30S_TTL_MS);

        Queue dlq = QueueBuilder.durable(DLQ).ttl(DLQ_TTL_MS).build();
        declarables.add(dlq);
        declarables.add(BindingBuilder.bind(dlq).to(dlx));

        return new Declarables(declarables);
    }

    private void addRetry(List<Declarable> declarables, String exchangeName, String queueName, int ttlMs) {
        FanoutExchange exchange = new FanoutExchange(exchangeName, true, false);
        Queue queue = QueueBuilder.durable(queueName)
                .ttl(ttlMs)
                .deadLetterExchange(JOB_EXCHANGE)
                .build();
        declarables.add(exchange);
        declarables.add(queue);
        declarables.add(BindingBuilder.bind(queue).to(exchange));
    }

    // 리스너·발행이 없으면 연결이 안 열려 선언도 안 되므로 기동 시 한 번 선언
    @EventListener(ApplicationReadyEvent.class)
    public void declareOnStartup(ApplicationReadyEvent event) {
        AmqpAdmin admin = event.getApplicationContext().getBean(AmqpAdmin.class);
        if (!(admin instanceof RabbitAdmin rabbitAdmin)) {
            return;
        }
        try {
            rabbitAdmin.initialize();
            log.info("RabbitMQ 교환기·큐 선언 완료");
        } catch (AmqpException e) {
            log.warn("RabbitMQ 교환기·큐 선언 실패 (연결되면 다시 선언): {}", e.getMessage());
        }
    }
}
