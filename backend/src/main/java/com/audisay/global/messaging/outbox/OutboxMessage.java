package com.audisay.global.messaging.outbox;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "outbox_messages")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class OutboxMessage {
    private static final int MAX_ERROR_LENGTH = 1000;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true)
    private UUID messageId;

    @Column(nullable = false, length = 100)
    private String exchange;

    @Column(nullable = false, length = 100)
    private String routingKey;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private String body;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private OutboxStatus status = OutboxStatus.PENDING;

    @Column(nullable = false)
    private Short attempts = 0;

    private String lastError;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    private Instant sentAt;

    public static OutboxMessage create(UUID messageId, String exchange, String routingKey, String body) {
        OutboxMessage message = new OutboxMessage();
        message.messageId = messageId;
        message.exchange = exchange;
        message.routingKey = routingKey;
        message.body = body;
        return message;
    }

    public void markSent() {
        if (status != OutboxStatus.PENDING) {
            return;
        }
        status = OutboxStatus.SENT;
        sentAt = Instant.now();
    }

    public void recordFailure(String error, int maxAttempts) {
        if (status != OutboxStatus.PENDING) {
            return;
        }
        attempts = (short) (attempts + 1);
        lastError = error == null || error.length() <= MAX_ERROR_LENGTH ? error : error.substring(0, MAX_ERROR_LENGTH);
        if (attempts >= maxAttempts) {
            status = OutboxStatus.FAILED;
        }
    }
}
