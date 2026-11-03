package com.audisay.domain.chat.entity;

/** 장면 이동을 찾은 방법: chapters.keywords 검색(KEYWORD) 또는 LLM 선택(LLM) */
public enum SeekSource {
    KEYWORD, LLM
}
