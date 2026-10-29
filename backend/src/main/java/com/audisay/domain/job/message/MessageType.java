package com.audisay.domain.job.message;

import com.audisay.global.config.RabbitConfig;
import lombok.Getter;
import lombok.RequiredArgsConstructor;

/** 봉투 type 값과 보낼 큐(라우팅 키). ai/app/mq/envelope.py의 MessageType과 같아야 한다 */
@Getter
@RequiredArgsConstructor
public enum MessageType {
    JOB_PREPARE(RabbitConfig.PREPARE_QUEUE),
    JOB_TRANSCRIBE(RabbitConfig.TRANSCRIBE_QUEUE),
    JOB_SCENE(RabbitConfig.SCENE_QUEUE),
    JOB_DESCRIBE(RabbitConfig.DESCRIBE_QUEUE),
    JOB_MERGE(RabbitConfig.MERGE_QUEUE),
    JOB_TTS(RabbitConfig.TTS_QUEUE),
    LINE_TTS(RabbitConfig.LINE_TTS_QUEUE),
    /** 워커 → Spring 이벤트. Spring이 보내지는 않고 받을 때 쓴다 */
    JOB_EVENT(RabbitConfig.EVENTS_QUEUE);

    private final String routingKey;
}
