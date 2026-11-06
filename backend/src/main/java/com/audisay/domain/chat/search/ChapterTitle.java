package com.audisay.domain.chat.search;

/** 끝난 장면(목차) 제목 하나. 질문 답변 RAG에서 앞 줄의 순서(몇 회·몇 번째)를 맞추는 데 쓴다 */
public record ChapterTitle(int startMs, String title) {
}
