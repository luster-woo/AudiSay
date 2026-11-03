package com.audisay.domain.chat.intent;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Arrays;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;

/**
 * 챗봇으로 바꿀 수 있는 재생 설정. key는 user_settings 칼럼 = 재생 설정 API 필드 이름.
 * 숫자 설정(min·max가 있는 것)만 "올려·내려" 같은 상대 변경을 받는다. 한 번에 바뀌는 양(step)은 재생 설정 창 한 칸보다 크게
 * (속도 0.1 → 0.2, 소리 10 → 20) 말 한 번에 바뀐 게 느껴지도록
 */
public enum SettingKey {
    DETAIL_LEVEL("detailLevel", 1, 3, 1, 0, "가장 자세한 해설이에요.", "가장 간단한 해설이에요."),
    SPEECH_RATE("speechRate", 0.5, 2.5, 0.2, 1, "가장 빠른 속도예요.", "가장 느린 속도예요."),
    ORIGINAL_VOLUME("originalVolume", 0, 100, 20, 0, "영상 소리가 가장 커요.", "영상 소리가 꺼졌어요."),
    FONT_SIZE_LEVEL("fontSizeLevel", 1, 5, 1, 0, "글자가 가장 커요.", "글자가 가장 작아요."),
    NARRATION_MODE("narrationMode", Set.of("AUTO", "WITH_VIDEO", "PAUSE_AFTER")),
    SOUND_MIX("soundMix", Set.of("DIALOGUE_ONLY", "DIALOGUE_AND_NARRATION")),
    SUBTITLE_READING("subtitleReading", Set.of("ALL", "DIFFERENT_ONLY", "OFF")),
    SEEK_STEP_SEC("seekStepSec", Set.of("5", "10", "30")),
    SUMMARY_MODE("summaryMode", Set.of("ASK", "ALWAYS", "NEVER")),
    HIGH_CONTRAST("highContrast", Set.of("true", "false"));

    private final String key;
    private final BigDecimal min;
    private final BigDecimal max;
    private final BigDecimal step;
    private final int scale;
    private final Set<String> values;
    private final String maxMessage;
    private final String minMessage;

    SettingKey(String key, double min, double max, double step, int scale, String maxMessage, String minMessage) {
        this.key = key;
        this.min = BigDecimal.valueOf(min);
        this.max = BigDecimal.valueOf(max);
        this.step = BigDecimal.valueOf(step);
        this.scale = scale;
        this.values = null;
        this.maxMessage = maxMessage;
        this.minMessage = minMessage;
    }

    SettingKey(String key, Set<String> values) {
        this.key = key;
        this.min = null;
        this.max = null;
        this.step = null;
        this.scale = 0;
        this.values = values;
        this.maxMessage = null;
        this.minMessage = null;
    }

    public String key() {
        return key;
    }

    public boolean numeric() {
        return values == null;
    }

    public BigDecimal min() {
        return min;
    }

    public BigDecimal max() {
        return max;
    }

    public static Optional<SettingKey> of(String key) {
        return Arrays.stream(values()).filter(k -> k.key.equals(key)).findFirst();
    }

    /** 값을 API 형식 문자열로 맞춘다. 숫자는 범위 끝값으로 자르고, 고를 수 있는 값이 아니면 null */
    public String normalize(String value) {
        if (value == null) {
            return null;
        }
        String v = value.strip();
        if (!numeric()) {
            String upper = this == HIGH_CONTRAST ? v.toLowerCase(Locale.ROOT) : v.toUpperCase(Locale.ROOT);
            return values.contains(upper) ? upper : null;
        }
        try {
            return format(new BigDecimal(v));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /** 지금 값에서 한 단계 올리거나 내린 값(범위 끝이면 끝값 그대로) */
    public String step(BigDecimal current, SettingDirection direction) {
        if (!numeric()) {
            throw new IllegalStateException(key + "는 올리고 내릴 수 없는 설정입니다.");
        }
        return format(direction == SettingDirection.UP ? current.add(step) : current.subtract(step));
    }

    /**
     * 바꾼 값이 범위 끝이면 읽어 줄 말, 아니면 null. 이미 끝이었으면(값이 그대로면) "이미 "를 붙인다
     */
    public String limitMessage(String before, String after) {
        if (!numeric()) {
            return null;
        }
        BigDecimal value = new BigDecimal(after);
        String message = value.compareTo(max) >= 0 ? maxMessage : value.compareTo(min) <= 0 ? minMessage : null;
        if (message == null) {
            return null;
        }
        return new BigDecimal(before).compareTo(value) == 0 ? "이미 " + message : message;
    }

    /** 숫자 설정 값을 범위 안으로 자르고 API 형식(정수 또는 소수 첫째 자리)으로 */
    public String format(BigDecimal value) {
        BigDecimal clamped = value.max(min).min(max).setScale(scale, RoundingMode.HALF_UP);
        return clamped.toPlainString();
    }
}
