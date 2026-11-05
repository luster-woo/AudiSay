package com.audisay.domain.chat.search;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * 장면 검색 RAG 설정 (application.yml의 audisay.scene-search).
 */
@ConfigurationProperties("audisay.scene-search")
public record SceneSearchProperties(Index index, Search search, Answer answer) {

    public SceneSearchProperties {
        index = index == null ? new Index(null, null, null, null, null) : index;
        search = search == null ? new Search(null, null, null) : search;
        answer = answer == null ? new Answer(null, null, null) : answer;
    }

    /**
     * 질문 답변 RAG. 바로 하는 답에는 지금 자료(앞 장면·지금 장면)보다 앞의 비슷한 줄을, 뒤 확인에는 질문 시각 뒤의 비슷한 줄을 넣는다.
     *
     * @param mode        OFF = 지금 자료만, FALLBACK = 지금 자료로 먼저 답하고 "자료에 없어요"면 앞 줄을 더해 다시, ALWAYS = 늘 앞 줄을 더해
     * @param earlierTopK 바로 하는 답에 더하는 앞 줄 수
     * @param laterTopK   뒤 확인에 넣는 뒤 줄 수(영상 요약과 함께, 뒤 내용 전체 대신)
     */
    public record Answer(Mode mode, Integer earlierTopK, Integer laterTopK) {

        public Answer {
            mode = mode == null ? Mode.FALLBACK : mode;
            earlierTopK = earlierTopK == null ? 8 : earlierTopK;
            laterTopK = laterTopK == null ? 12 : laterTopK;
        }
    }

    /**
     * 색인. 해설 공개 직후 바로 하고, 5분마다 스케줄러가 놓친 것·실패·수정된 해설·보관된 해설 정리를 맡는다.
     *
     * @param batchSize         스케줄러 한 번에 색인하는 해설 수
     * @param retryAfter        FAILED를 다시 시도하기까지
     * @param stuckAfter        PENDING이 이보다 오래면 멈춘 것으로 보고 다시 맡는다
     * @param archivedRetention 재생성으로 보관(ARCHIVED)된 해설의 색인을 새 해설이 생긴 뒤 이만큼 지나면 지운다
     */
    public record Index(Boolean enabled, Integer batchSize, Duration retryAfter, Duration stuckAfter,
                        Duration archivedRetention) {

        public Index {
            enabled = enabled == null || enabled;
            batchSize = batchSize == null ? 5 : batchSize;
            retryAfter = retryAfter == null ? Duration.ofMinutes(30) : retryAfter;
            stuckAfter = stuckAfter == null ? Duration.ofMinutes(10) : stuckAfter;
            archivedRetention = archivedRetention == null ? Duration.ofDays(7) : archivedRetention;
        }
    }

    /** OFF = 지금 방식, FALLBACK = 키워드가 확실하면 그대로·애매하거나 못 찾으면 RAG, ALWAYS = 늘 RAG */
    public enum Mode { OFF, FALLBACK, ALWAYS }

    /**
     * 장면 찾기에서 RAG를 쓰는 방식.
     *
     * @param candidates 키워드·벡터 후보를 RRF로 합친 뒤 LLM이 확인할 개수
     * @param vectorTopK 벡터 검색으로 가져올 줄 수
     */
    public record Search(Mode mode, Integer candidates, Integer vectorTopK) {

        public Search {
            mode = mode == null ? Mode.FALLBACK : mode;
            candidates = candidates == null ? 5 : candidates;
            vectorTopK = vectorTopK == null ? 20 : vectorTopK;
        }
    }
}
