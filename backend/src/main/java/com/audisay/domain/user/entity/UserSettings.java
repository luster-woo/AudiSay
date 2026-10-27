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

    @Column(nullable = false)
    private Short originalVolume = 100;

    @Column(length = 50)
    private String voiceCode;

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
}
