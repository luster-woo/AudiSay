package com.audisay.domain.chat.entity;

/** 답변 근거. 첫 버전은 STORED(저장된 해설 자료)·UNANSWERABLE만 쓴다 */
public enum AnswerSource {
    STORED, FRAME, GEMINI_REQUERY, CACHE, UNANSWERABLE
}
