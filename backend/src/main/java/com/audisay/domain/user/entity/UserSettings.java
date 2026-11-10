package com.audisay.domain.user.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.MapsId;
import jakarta.persistence.OneToOne;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.UpdateTimestamp;

import java.math.BigDecimal;
import java.time.Instant;

@Entity
@Table(name = "user_settings")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class UserSettings {
    @Id
    private Long userId;

    @MapsId
    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id")
    private User user;

    // DB 기본값은 JPA insert 때 적용되지 않으므로(null을 그대로 넣음) 기본값을 여기서 채운다
    @Column(nullable = false)
    private Short detailLevel = 2;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private NarrationMode narrationMode = NarrationMode.AUTO;

    @Column(nullable = false, precision = 2, scale = 1)
    private BigDecimal speechRate = new BigDecimal("1.0");

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private SoundMix soundMix = SoundMix.DIALOGUE_AND_NARRATION;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private SubtitleReading subtitleReading = SubtitleReading.DIFFERENT_ONLY;

    /** 외국어 대사 번역 읽기. 해설(soundMix)을 꺼도 따로 켜 둘 수 있다 */
    @Column(nullable = false)
    private boolean translationReading = true;

    @Column(nullable = false)
    private Short originalVolume = 100;

    @Column(nullable = false)
    private Short seekStepSec = 10;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private SummaryMode summaryMode = SummaryMode.ASK;

    @Column(nullable = false)
    private boolean highContrast = false;

    @Column(nullable = false)
    private Short fontSizeLevel = 3;

    private Instant tutorialCompletedAt;

    @UpdateTimestamp
    @Column(nullable = false)
    private Instant updatedAt;

    public static UserSettings createDefault(User user) {
        UserSettings settings = new UserSettings();
        settings.user = user;
        return settings;
    }

    public boolean isTutorialCompleted() {
        return tutorialCompletedAt != null;
    }

    /**
     * null인 필드는 바꾸지 않는다(부분 수정). 값 범위는 요청 DTO와 DB CHECK가 막는다.
     */
    public void update(Patch patch, Instant now) {
        if (patch.detailLevel() != null) {
            detailLevel = patch.detailLevel();
        }
        if (patch.narrationMode() != null) {
            narrationMode = patch.narrationMode();
        }
        if (patch.speechRate() != null) {
            speechRate = patch.speechRate();
        }
        if (patch.soundMix() != null) {
            soundMix = patch.soundMix();
        }
        if (patch.subtitleReading() != null) {
            subtitleReading = patch.subtitleReading();
        }
        if (patch.translationReading() != null) {
            translationReading = patch.translationReading();
        }
        if (patch.originalVolume() != null) {
            originalVolume = patch.originalVolume();
        }
        if (patch.seekStepSec() != null) {
            seekStepSec = patch.seekStepSec();
        }
        if (patch.summaryMode() != null) {
            summaryMode = patch.summaryMode();
        }
        if (patch.highContrast() != null) {
            highContrast = patch.highContrast();
        }
        if (patch.fontSizeLevel() != null) {
            fontSizeLevel = patch.fontSizeLevel();
        }
        if (patch.tutorialCompleted() != null) {
            // false는 튜토리얼 다시 보기
            tutorialCompletedAt = patch.tutorialCompleted() ? now : null;
        }
    }

    public record Patch(
            Short detailLevel,
            NarrationMode narrationMode,
            BigDecimal speechRate,
            SoundMix soundMix,
            SubtitleReading subtitleReading,
            Boolean translationReading,
            Short originalVolume,
            Short seekStepSec,
            SummaryMode summaryMode,
            Boolean highContrast,
            Short fontSizeLevel,
            Boolean tutorialCompleted
    ) {
    }
}
