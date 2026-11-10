package com.audisay.domain.chat.intent;

import com.audisay.domain.chat.entity.ChatIntent;
import com.audisay.domain.user.dto.response.SettingsResponse;
import com.audisay.domain.user.entity.NarrationMode;
import com.audisay.domain.user.entity.SoundMix;
import com.audisay.domain.user.entity.SubtitleReading;
import com.audisay.domain.user.entity.SummaryMode;
import com.audisay.domain.user.service.UserSettingsService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SettingStepResolverTest {
    private static final Long USER_ID = 2L;

    private final UserSettingsService userSettingsService = mock(UserSettingsService.class);
    private final SettingStepResolver resolver = new SettingStepResolver(userSettingsService);

    @ParameterizedTest(name = "{0} {1}: {2} → {3} {4}")
    @CsvSource(delimiter = '|', textBlock = """
            speechRate     | UP   | 1.0 | 1.2 |
            speechRate     | UP   | 2.4 | 2.5 | 가장 빠른 속도예요.
            speechRate     | UP   | 2.5 | 2.5 | 이미 가장 빠른 속도예요.
            speechRate     | DOWN | 1.0 | 0.8 |
            speechRate     | DOWN | 0.5 | 0.5 | 이미 가장 느린 속도예요.
            detailLevel    | UP   | 2   | 3   | 가장 자세한 해설이에요.
            detailLevel    | DOWN | 2   | 1   | 가장 간단한 해설이에요.
            originalVolume | DOWN | 100 | 80  |
            originalVolume | DOWN | 10  | 0   | 영상 소리가 꺼졌어요.
            originalVolume | UP   | 90  | 100 | 영상 소리가 가장 커요.
            fontSizeLevel  | UP   | 3   | 4   |
            fontSizeLevel  | DOWN | 1   | 1   | 이미 글자가 가장 작아요.
            """)
    void 지금_값에서_한_단계_바꾸고_범위_끝이면_알린다(String key, SettingDirection direction, String current, String expected,
                                         String message) {
        when(userSettingsService.getSettings(USER_ID)).thenReturn(settings(key, new BigDecimal(current)));

        ClassifiedIntent result = resolver.resolve(ClassifiedIntent.settingStep(key, direction), USER_ID);

        assertThat(result.intent()).isEqualTo(ChatIntent.SETTING);
        assertThat(result.settingKey()).isEqualTo(key);
        assertThat(result.settingValue()).isEqualTo(expected);
        assertThat(result.direction()).isNull();
        assertThat(result.message()).isEqualTo(message);
    }

    @Test
    void 절대값이나_다른_intent는_설정을_읽지_않고_그대로_둔다() {
        ClassifiedIntent absolute = ClassifiedIntent.setting("speechRate", "1.5");
        ClassifiedIntent question = ClassifiedIntent.of(ChatIntent.QUESTION);

        assertThat(resolver.resolve(absolute, USER_ID)).isSameAs(absolute);
        assertThat(resolver.resolve(question, USER_ID)).isSameAs(question);
        verify(userSettingsService, never()).getSettings(any());
    }

    private static SettingsResponse settings(String key, BigDecimal value) {
        int detail = key.equals("detailLevel") ? value.intValue() : 2;
        BigDecimal rate = key.equals("speechRate") ? value : new BigDecimal("1.0");
        int volume = key.equals("originalVolume") ? value.intValue() : 100;
        int font = key.equals("fontSizeLevel") ? value.intValue() : 3;
        return new SettingsResponse(detail, NarrationMode.AUTO, rate, SoundMix.DIALOGUE_AND_NARRATION,
                SubtitleReading.DIFFERENT_ONLY, true, volume, 10, SummaryMode.ASK, false, font, true);
    }
}
