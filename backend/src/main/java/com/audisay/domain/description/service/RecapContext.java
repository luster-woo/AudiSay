package com.audisay.domain.description.service;

import java.util.List;

/**
 * 지금까지 줄거리(RECAP) 자료. 질문한 시각 전에 시작한 장면만, 질문한 시각 뒤 내용은 넣지 않는다
 *
 * @param parts 시간순. 끝난 장면은 제목·목차 요약, 지금 장면은 질문한 시각까지의 해설 문장(제목 없음)
 */
public record RecapContext(String videoTitle, int nowMs, List<Part> parts) {

    public record Part(int startMs, String title, String text) {
    }
}
