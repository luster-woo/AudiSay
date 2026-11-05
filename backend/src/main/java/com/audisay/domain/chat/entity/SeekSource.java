package com.audisay.domain.chat.entity;

/** 장면 이동을 찾은 방법: 키워드 검색(KEYWORD), LLM이 목차에서 선택(LLM), 키워드 + 벡터 검색 후보를 LLM이 확인(RAG) */
public enum SeekSource {
    KEYWORD, LLM, RAG
}
