package com.audisay.domain.chat.intent;

import com.audisay.domain.chat.entity.ChatIntent;

/**
 * 발화 분류 결과(규칙 또는 LLM). intent마다 쓰는 칸만 채운다.
 *
 * @param targetMs     SEEK_TIME 절대 시각
 * @param relativeMs   SEEK_TIME 지금 위치 기준 이동(되감기는 음수)
 * @param toEnd        SEEK_TIME "끝으로"(영상 길이를 아는 쪽에서 계산)
 * @param query        SEEK_SCENE 찾을 장면, SEARCH_VIDEO 검색어
 * @param settingValue SETTING 절대값. 상대 변경이면 null이고 direction이 있다
 * @param message      사용자에게 읽어 줄 말. UNKNOWN 안내, 설정이 범위 끝에 닿았을 때("가장 빠른 속도예요.")
 */
public record ClassifiedIntent(ChatIntent intent, Integer targetMs, Integer relativeMs, boolean toEnd, String query,
                               String settingKey, String settingValue, SettingDirection direction,
                               ActionCode actionCode, String message) {

    public static ClassifiedIntent of(ChatIntent intent) {
        return new ClassifiedIntent(intent, null, null, false, null, null, null, null, null, null);
    }

    public static ClassifiedIntent seekTo(int targetMs) {
        return new ClassifiedIntent(ChatIntent.SEEK_TIME, targetMs, null, false, null, null, null, null, null, null);
    }

    public static ClassifiedIntent seekBy(int relativeMs) {
        return new ClassifiedIntent(ChatIntent.SEEK_TIME, null, relativeMs, false, null, null, null, null, null, null);
    }

    public static ClassifiedIntent seekToEnd() {
        return new ClassifiedIntent(ChatIntent.SEEK_TIME, null, null, true, null, null, null, null, null, null);
    }

    public static ClassifiedIntent seekScene(String query) {
        return new ClassifiedIntent(ChatIntent.SEEK_SCENE, null, null, false, query, null, null, null, null, null);
    }

    public static ClassifiedIntent setting(String settingKey, String settingValue) {
        return new ClassifiedIntent(ChatIntent.SETTING, null, null, false, null, settingKey, settingValue, null, null, null);
    }

    public static ClassifiedIntent settingStep(String settingKey, SettingDirection direction) {
        return new ClassifiedIntent(ChatIntent.SETTING, null, null, false, null, settingKey, null, direction, null, null);
    }

    public static ClassifiedIntent action(ActionCode actionCode) {
        return new ClassifiedIntent(ChatIntent.ACTION, null, null, false, null, null, null, null, actionCode, null);
    }

    public static ClassifiedIntent searchVideo(String query) {
        return new ClassifiedIntent(ChatIntent.SEARCH_VIDEO, null, null, false, query, null, null, null, null, null);
    }

    public ClassifiedIntent withMessage(String message) {
        return new ClassifiedIntent(intent, targetMs, relativeMs, toEnd, query, settingKey, settingValue, direction,
                actionCode, message);
    }

    public static ClassifiedIntent unknown(String message) {
        return new ClassifiedIntent(ChatIntent.UNKNOWN, null, null, false, null, null, null, null, null, message);
    }
}
