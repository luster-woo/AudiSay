package com.audisay.domain.chat.intent;

import com.audisay.domain.chat.entity.ChatIntent;

import java.util.Locale;
import java.util.Map;

/**
 * LLM 응답 {intent, slots}를 ClassifiedIntent로 바꾼다. 값이 하나라도 이상하면 UNKNOWN(잘못 실행하는 것보다 다시 묻는 게 낫다).
 * 시각이 없는 SEEK_TIME은 장면 이동으로 바꾼다(0초로 가 버리지 않게, AI 서버 from_model과 같음)
 */
final class IntentSlotMapper {
    private static final int MAX_QUERY_LENGTH = 100;

    private IntentSlotMapper() {
    }

    static ClassifiedIntent map(String intentName, Map<String, Object> slots, String utterance) {
        ChatIntent intent = parseEnum(ChatIntent.class, intentName);
        Map<String, Object> s = slots == null ? Map.of() : slots;
        if (intent == null) {
            return ClassifiedIntent.unknown(null);
        }
        return switch (intent) {
            case QUESTION, SCENE_NOW -> ClassifiedIntent.of(intent);
            case SEEK_TIME -> seekTime(s, utterance);
            case SEEK_SCENE -> ClassifiedIntent.seekScene(query(s.get("query"), utterance));
            case SETTING -> setting(s);
            case ACTION -> {
                ActionCode code = parseEnum(ActionCode.class, string(s.get("actionCode")));
                yield code == null ? ClassifiedIntent.unknown(null) : ClassifiedIntent.action(code);
            }
            case SEARCH_VIDEO -> {
                String query = query(s.get("query"), null);
                yield query == null ? ClassifiedIntent.unknown(null) : ClassifiedIntent.searchVideo(query);
            }
            case UNKNOWN -> ClassifiedIntent.unknown(null);
        };
    }

    private static ClassifiedIntent seekTime(Map<String, Object> s, String utterance) {
        if (Boolean.TRUE.equals(s.get("toEnd"))) {
            return ClassifiedIntent.seekToEnd();
        }
        Integer target = integer(s.get("targetMs"));
        if (target != null && target >= 0) {
            return ClassifiedIntent.seekTo(target);
        }
        Integer relative = integer(s.get("relativeMs"));
        if (relative != null && relative != 0) {
            return ClassifiedIntent.seekBy(relative);
        }
        return ClassifiedIntent.seekScene(query(null, utterance));
    }

    private static ClassifiedIntent setting(Map<String, Object> s) {
        SettingKey key = SettingKey.of(string(s.get("settingKey"))).orElse(null);
        if (key == null) {
            return ClassifiedIntent.unknown(null);
        }
        String value = key.normalize(string(s.get("settingValue")));
        if (value != null) {
            return ClassifiedIntent.setting(key.key(), value);
        }
        SettingDirection direction = parseEnum(SettingDirection.class, string(s.get("direction")));
        if (direction != null && key.numeric()) {
            return ClassifiedIntent.settingStep(key.key(), direction);
        }
        return ClassifiedIntent.unknown(null);
    }

    private static String query(Object value, String fallback) {
        String q = string(value);
        if (q == null || q.isBlank()) {
            q = fallback;
        }
        if (q == null) {
            return null;
        }
        q = q.strip();
        return q.length() > MAX_QUERY_LENGTH ? q.substring(0, MAX_QUERY_LENGTH) : q;
    }

    private static String string(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private static Integer integer(Object value) {
        if (value instanceof Number n) {
            double d = n.doubleValue();
            return Math.abs(d) > Integer.MAX_VALUE ? null : (int) Math.round(d);
        }
        if (value instanceof String str) {
            try {
                return Integer.valueOf(str.strip());
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return null;
    }

    private static <E extends Enum<E>> E parseEnum(Class<E> type, String name) {
        if (name == null) {
            return null;
        }
        try {
            return Enum.valueOf(type, name.strip().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
