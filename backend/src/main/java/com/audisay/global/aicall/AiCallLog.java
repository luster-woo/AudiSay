package com.audisay.global.aicall;

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

import java.math.BigDecimal;
import java.time.Instant;

/**
 * AI 호출 기록. 작업·조각·챗봇 기록 중 최대 한 곳에만 연결된다(ck_ai_call_logs_target).
 */
@Entity
@Table(name = "ai_call_logs")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class AiCallLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private Long jobId;

    private Long chunkId;

    private Long chatLogId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 15)
    private AiCallPurpose purpose;

    @Column(nullable = false, length = 50)
    private String model;

    @Column(nullable = false)
    private Integer inputTokens = 0;

    @Column(nullable = false)
    private Integer outputTokens = 0;

    @Column(nullable = false)
    private Short imageCount = 0;

    @Column(nullable = false, precision = 10, scale = 2)
    private BigDecimal estimatedCredits = BigDecimal.ZERO;

    private Integer latencyMs;

    @Column(name = "is_fallback", nullable = false)
    private Boolean fallback = false;

    @Column(length = 50)
    private String errorCode;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    /** 챗봇 LLM 호출 한 번. 실패면 errorCode, 토큰은 0. fallback = 대체 모델 호출 */
    public static AiCallLog chat(AiCallPurpose purpose, String model, Long chatLogId, int inputTokens, int outputTokens,
                                 BigDecimal estimatedCredits, int latencyMs, boolean fallback, String errorCode) {
        AiCallLog log = new AiCallLog();
        log.purpose = purpose;
        log.model = model;
        log.chatLogId = chatLogId;
        log.inputTokens = inputTokens;
        log.outputTokens = outputTokens;
        log.estimatedCredits = estimatedCredits;
        log.latencyMs = latencyMs;
        log.fallback = fallback;
        log.errorCode = errorCode;
        return log;
    }
}
