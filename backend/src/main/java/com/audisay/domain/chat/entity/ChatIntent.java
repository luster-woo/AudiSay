package com.audisay.domain.chat.entity;

/** chat_logs.intent (DB CHECK 값 그대로). SEARCH_VIDEO는 V5에서 추가 */
public enum ChatIntent {
    QUESTION, SCENE_NOW, SEEK_SCENE, SEEK_TIME, SETTING, ACTION, SEARCH_VIDEO, UNKNOWN
}
