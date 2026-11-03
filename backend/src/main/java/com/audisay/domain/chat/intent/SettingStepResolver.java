package com.audisay.domain.chat.intent;

import com.audisay.domain.chat.entity.ChatIntent;
import com.audisay.domain.user.dto.response.SettingsResponse;
import com.audisay.domain.user.service.UserSettingsService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;

/**
 * "더 빠르게"·"소리 줄여" 같은 상대 변경을 회원의 지금 설정값으로 최종값으로 바꾼다.
 * 범위 끝에 닿으면 message로 알린다("가장 빠른 속도예요.", 이미 끝이었으면 "이미 가장 빠른 속도예요.").
 * 저장은 하지 않는다 — FE가 응답 값을 적용하고 재생 설정 변경 API로 저장한다
 */
@Component
@RequiredArgsConstructor
public class SettingStepResolver {
    private final UserSettingsService userSettingsService;

    public ClassifiedIntent resolve(ClassifiedIntent classified, Long userId) {
        if (classified.intent() != ChatIntent.SETTING || classified.direction() == null) {
            return classified;
        }
        SettingKey key = SettingKey.of(classified.settingKey())
                .orElseThrow(() -> new IllegalStateException("알 수 없는 설정: " + classified.settingKey()));
        SettingsResponse settings = userSettingsService.getSettings(userId);
        BigDecimal current = switch (key) {
            case DETAIL_LEVEL -> BigDecimal.valueOf(settings.detailLevel());
            case SPEECH_RATE -> settings.speechRate();
            case ORIGINAL_VOLUME -> BigDecimal.valueOf(settings.originalVolume());
            case FONT_SIZE_LEVEL -> BigDecimal.valueOf(settings.fontSizeLevel());
            default -> throw new IllegalStateException(key.key() + "는 올리고 내릴 수 없는 설정입니다.");
        };
        String value = key.step(current, classified.direction());
        return ClassifiedIntent.setting(key.key(), value).withMessage(key.limitMessage(key.format(current), value));
    }
}
