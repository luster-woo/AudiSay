package com.audisay.domain.user.dto.response;

import com.audisay.domain.user.entity.NarrationMode;
import com.audisay.domain.user.entity.SoundMix;
import com.audisay.domain.user.entity.SubtitleReading;
import com.audisay.domain.user.entity.SummaryMode;
import com.audisay.domain.user.entity.UserSettings;

import java.math.BigDecimal;

public record SettingsResponse(
        int detailLevel,
        NarrationMode narrationMode,
        BigDecimal speechRate,
        SoundMix soundMix,
        SubtitleReading subtitleReading,
        int originalVolume,
        int seekStepSec,
        SummaryMode summaryMode,
        boolean highContrast,
        int fontSizeLevel,
        boolean tutorialCompleted
) {
    public static SettingsResponse from(UserSettings settings) {
        return new SettingsResponse(
                settings.getDetailLevel(),
                settings.getNarrationMode(),
                settings.getSpeechRate(),
                settings.getSoundMix(),
                settings.getSubtitleReading(),
                settings.getOriginalVolume(),
                settings.getSeekStepSec(),
                settings.getSummaryMode(),
                settings.isHighContrast(),
                settings.getFontSizeLevel(),
                settings.isTutorialCompleted()
        );
    }
}
