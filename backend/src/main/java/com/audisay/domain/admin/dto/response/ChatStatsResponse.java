package com.audisay.domain.admin.dto.response;

import java.time.LocalDate;
import java.util.List;

/**
 * 챗봇 품질 통계(관리자). 비율은 0~1, 시간은 ms
 *
 * @param inputs 기간 안 챗봇 입력 수
 */
public record ChatStatsResponse(LocalDate from, LocalDate to, long inputs, List<IntentStat> byIntent, AnswerStat answer,
                                SeekStat seek, List<Unanswered> recentUnanswered) {

    /** @param intentP50Ms 분류 시간(규칙이면 거의 0) */
    public record IntentStat(String intent, long count, Long intentP50Ms, Long intentP95Ms) {
    }

    /**
     * @param questions           끝까지 간 질문(QUESTION) 답변 수
     * @param notAnsweredDirectly 질문한 시각까지 자료로 바로 답하지 못한 질문(UNANSWERABLE + 나중에 FUTURE)
     * @param futureOffered       그중 뒤에 답이 있어 "들으시겠어요?"를 물은 수
     * @param futureChosen        그중 사용자가 듣기로 한 수(FUTURE)
     * @param unanswerableRate    notAnsweredDirectly / questions
     * @param futureOfferedRate   futureOffered / notAnsweredDirectly
     * @param futureChosenRate    futureChosen / futureOffered
     */
    public record AnswerStat(List<AnswerIntentStat> byIntent, long questions, long notAnsweredDirectly, long futureOffered,
                             long futureChosen, double unanswerableRate, double futureOfferedRate, double futureChosenRate) {
    }

    public record AnswerIntentStat(String intent, long answered, long stored, long unanswerable, long future,
                                   Long firstAudioP50Ms, Long firstAudioP95Ms) {
    }

    /** @param notFound 못 찾음(seek_source 없음) */
    public record SeekStat(long total, long keyword, long llm, long notFound, double keywordRate) {
    }

    /** 어디에도 답이 없던 질문(해설 보완 후보) */
    public record Unanswered(Long chatLogId, Long videoId, String videoTitle, Integer videoTimeMs, String utterance,
                             String createdAt) {
    }
}
