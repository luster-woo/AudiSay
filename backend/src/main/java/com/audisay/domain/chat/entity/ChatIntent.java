package com.audisay.domain.chat.entity;

/** chat_logs.intent (DB CHECK 값 그대로). SEARCH_VIDEO는 V5, RECAP(지금까지 줄거리)은 V6에서 추가 */
public enum ChatIntent {
    QUESTION, SCENE_NOW, SEEK_SCENE, SEEK_TIME, SETTING, ACTION, SEARCH_VIDEO, RECAP, UNKNOWN
}
