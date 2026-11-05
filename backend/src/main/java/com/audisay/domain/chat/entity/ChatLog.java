package com.audisay.domain.chat.entity;

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

import java.time.Instant;

/**
 * 챗봇 입력 한 건. 입력 때 UNKNOWN으로 먼저 저장하고(LLM 호출 기록 ai_call_logs.chat_log_id를 걸기 위해) 분류가 끝나면
 * {@link #classify}로 채운다. 답변 칸(answer_*·first_audio_ms·total_latency_ms)은 QUESTION·SCENE_NOW 답변 스트림에서 채운다
 */
@Entity
@Table(name = "chat_logs")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ChatLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long userId;

    private Long videoId;

    private Long descriptionId;

    private Integer videoTimeMs;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 5)
    private InputMode inputMode;

    @Column(nullable = false)
    private String utterance;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 15)
    private ChatIntent intent = ChatIntent.UNKNOWN;

    private Integer targetMs;

    private Long targetChapterId;

    @Enumerated(EnumType.STRING)
    @Column(length = 10)
    private SeekSource seekSource;

    private Integer intentLatencyMs;

    private String answerText;

    @Enumerated(EnumType.STRING)
    @Column(length = 15)
    private AnswerSource answerSource;

    private Integer firstAudioMs;

    private Integer totalLatencyMs;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant createdAt;
    
    public static ChatLog receive(Long userId, Long videoId, Long descriptionId, Integer videoTimeMs,
                                  InputMode inputMode, String utterance) {
        ChatLog log = new ChatLog();
        log.userId = userId;
        log.videoId = videoId;
        log.descriptionId = descriptionId;
        log.videoTimeMs = videoTimeMs;
        log.inputMode = inputMode;
        log.utterance = utterance;
        return log;
    }

    public void classify(ChatIntent intent, int intentLatencyMs) {
        this.intent = intent;
        this.intentLatencyMs = intentLatencyMs;
    }

    /** SEEK_TIME, 또는 SEEK_SCENE 후보가 하나일 때 */
    public void target(Integer targetMs, Long targetChapterId, SeekSource seekSource) {
        this.targetMs = targetMs;
        this.targetChapterId = targetChapterId;
        this.seekSource = seekSource;
    }

    /**
     * 답변 스트림이 끝났다(실패·취소면 source는 null이고 받은 데까지만).
     * 이미 끝난 답(예: "들으시겠어요?"까지 읽은 UNANSWERABLE)을 실패한 재답변(includeFuture)으로 덮지 않는다
     */
    public void answer(String answerText, AnswerSource answerSource, Integer firstAudioMs, int totalLatencyMs) {
        if (answerSource == null && this.answerSource != null) {
            return;
        }
        this.answerText = answerText;
        this.answerSource = answerSource;
        this.firstAudioMs = firstAudioMs;
        this.totalLatencyMs = totalLatencyMs;
    }

    /** 답변을 끝까지 만들었는지(다시 구독하면 done만 보낸다). 실패·취소한 답은 다시 구독하면 새로 만든다 */
    public boolean isAnswered() {
        return answerSource != null;
    }

    public boolean isAnswerable() {
        return intent == ChatIntent.QUESTION || intent == ChatIntent.SCENE_NOW || intent == ChatIntent.RECAP;
    }
}
