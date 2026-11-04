package com.audisay.domain.chat.entity;

/** 답변 근거. STORED(질문한 시각까지 저장된 해설 자료)·UNANSWERABLE·FUTURE(사용자가 고른 지금 이후 내용 답변, V6)를 쓴다 */
public enum AnswerSource {
    STORED, FRAME, GEMINI_REQUERY, CACHE, UNANSWERABLE, FUTURE
}
