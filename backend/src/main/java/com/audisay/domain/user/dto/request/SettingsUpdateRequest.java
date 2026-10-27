package com.audisay.domain.user.dto.request;

import com.audisay.domain.user.entity.NarrationMode;
import com.audisay.domain.user.entity.SoundMix;
import com.audisay.domain.user.entity.SubtitleReading;
import com.audisay.domain.user.entity.SummaryMode;
import com.audisay.domain.user.entity.UserSettings;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

import java.math.BigDecimal;
import java.util.Set;

/**
 * 바꿀 필드만 보낸다. 보내지 않은 필드(null)는 그대로 둔다. 범위는 DB CHECK와 같다.
 */
public record SettingsUpdateRequest(
        @Min(value = 1, message = "상세도는 1~3 사이여야 합니다.")
        @Max(value = 3, message = "상세도는 1~3 사이여야 합니다.")
        Integer detailLevel,

        NarrationMode narrationMode,

        @DecimalMin(value = "0.5", message = "말하기 속도는 0.5~2.5 사이여야 합니다.")
        @DecimalMax(value = "2.5", message = "말하기 속도는 0.5~2.5 사이여야 합니다.")
        @Digits(integer = 1, fraction = 1, message = "말하기 속도는 소수 첫째 자리까지만 쓸 수 있습니다.")
        BigDecimal speechRate,

        SoundMix soundMix,

        SubtitleReading subtitleReading,

        @Min(value = 0, message = "원래 소리 크기는 0~100 사이여야 합니다.")
        @Max(value = 100, message = "원래 소리 크기는 0~100 사이여야 합니다.")
        Integer originalVolume,

        Integer seekStepSec,

        SummaryMode summaryMode,

        Boolean highContrast,

        @Min(value = 1, message = "글자 크기는 1~5 사이여야 합니다.")
        @Max(value = 5, message = "글자 크기는 1~5 사이여야 합니다.")
        Integer fontSizeLevel,

        Boolean tutorialCompleted
) {
    private static final Set<Integer> SEEK_STEPS = Set.of(5, 10, 30);

    @AssertTrue(message = "이동 간격은 5, 10, 30초 중 하나여야 합니다.")
    public boolean isSeekStepSecValid() {
        return seekStepSec == null || SEEK_STEPS.contains(seekStepSec);
    }

    public UserSettings.Patch toPatch() {
        return new UserSettings.Patch(
                toShort(detailLevel),
                narrationMode,
                speechRate,
                soundMix,
                subtitleReading,
                toShort(originalVolume),
                toShort(seekStepSec),
                summaryMode,
                highContrast,
                toShort(fontSizeLevel),
                tutorialCompleted
        );
    }

    private static Short toShort(Integer value) {
        return value == null ? null : value.shortValue();
    }
}
