package com.audisay.domain.description.service;

import java.util.List;

/**
 * 장면 찾기용 장면 하나(목차 한 칸)의 글 전체. 목차(제목·요약·키워드)와 장면 설명에, 같은 구간 [startMs, endMs)의
 * 해설 문장(v1~v3)·대사·화면 글자를 시각과 함께(moments) 붙인다. 장면 검색 RAG(2단계)에서 이 단위로 임베딩한다
 */
public record SceneText(Long chapterId, int chapterIndex, int startMs, int endMs, String title, String summary,
                        List<String> keywords, String sceneDescription, List<Moment> moments) {

    public enum MomentType { NARRATION, DIALOGUE, SCREEN }

    /** 시각이 있는 글 한 줄. 여기서 찾으면 목차 시작이 아니라 이 시각으로 간다 */
    public record Moment(int startMs, MomentType type, String text) {
    }
}
