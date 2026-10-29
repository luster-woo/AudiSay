package com.audisay.global.messaging.outbox;

import java.util.UUID;

record OutboxSavedEvent(Long outboxId, UUID messageId, String exchange, String routingKey, String body) {
}
