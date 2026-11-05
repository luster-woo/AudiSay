package com.audisay.domain.chat.search;

/** 벡터 검색으로 찾은 줄 하나. similarity = 1 − 코사인 거리 */
public record VectorLine(String sourceType, long sourceId, int startMs, String text, double similarity) {
}
