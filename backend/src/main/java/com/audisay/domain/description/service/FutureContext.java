package com.audisay.domain.description.service;

import com.audisay.domain.description.service.AnswerContext.Dialogue;
import com.audisay.domain.description.service.AnswerContext.SceneInfo;

import java.util.List;

/**
 * 질문한 시각 뒤의 자료. 뒤에 답이 있는지 확인할 때와, 사용자가 "지금 이후 내용"을 듣기로 했을 때 쓴다
 *
 * @param scenes    지금 장면부터 끝까지(장면 설명은 전체, 해설 문장·화면 글자는 질문한 시각 뒤만)
 * @param dialogues 질문한 시각 뒤 대사
 */
public record FutureContext(String summary, List<SceneInfo> scenes, List<Dialogue> dialogues) {
}
