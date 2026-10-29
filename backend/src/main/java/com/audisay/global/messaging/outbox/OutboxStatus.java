package com.audisay.global.messaging.outbox;

public enum OutboxStatus {
    PENDING,
    SENT,
    /** 재시도 한도 초과. 자동 재발행하지 않는다 */
    FAILED
}
