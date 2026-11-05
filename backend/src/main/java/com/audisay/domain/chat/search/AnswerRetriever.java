package com.audisay.domain.chat.search;

import com.audisay.global.external.embedding.EmbeddingClient;
import com.audisay.global.external.llm.LlmException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Component;

import java.util.Comparator;
import java.util.List;

/**
 * 질문 답변 RAG(342). 질문을 한 번 임베딩해, 바로 하는 답에는 지금 자료보다 앞의 비슷한 줄을, 뒤 확인에는 질문 시각 뒤의 비슷한 줄을 찾는다.
 * 꺼져 있거나 색인이 없거나 임베딩이 실패하면 null·빈 목록 → 호출한 쪽이 예전 방식으로
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AnswerRetriever {
    private final SceneSearchStore store;
    private final EmbeddingClient embeddingClient;
    private final SceneSearchProperties properties;

    public SceneSearchProperties.Mode mode() {
        return properties.answer().mode();
    }

    /** 질문 벡터(ai_call_logs EMBED에 chatLogId로). 못 쓰면 null */
    public float[] embed(long descriptionId, String question, Long chatLogId) {
        if (mode() == SceneSearchProperties.Mode.OFF || question == null || question.isBlank()) {
            return null;
        }
        try {
            if (!store.hasLines(descriptionId, embeddingClient.model())) {
                return null;
            }
            return embeddingClient.embedQuery(question, chatLogId);
        } catch (LlmException e) {
            log.warn("[CHAT] 질문 임베딩 실패({}), 지금 자료만으로 답함: {}", e.getKind(), e.getMessage());
            return null;
        } catch (DataAccessException e) {
            log.warn("[CHAT] 색인 확인 실패, 지금 자료만으로 답함: {}", e.getMessage());
            return null;
        }
    }

    /** start_ms < beforeMs 인 줄 중 비슷한 earlierTopK개를 시간순으로. 지금 자료보다 앞이라 모두 끝난 장면(스포일러 없음) */
    public List<VectorLine> before(long descriptionId, float[] vector, int beforeMs) {
        if (vector == null || beforeMs <= 0) {
            return List.of();
        }
        return search(descriptionId, vector, properties.answer().earlierTopK(), 0, beforeMs);
    }

    /** start_ms > afterMs 인 줄 중 비슷한 laterTopK개를 시간순으로 */
    public List<VectorLine> after(long descriptionId, float[] vector, int afterMs) {
        if (vector == null) {
            return List.of();
        }
        return search(descriptionId, vector, properties.answer().laterTopK(), afterMs + 1, Integer.MAX_VALUE);
    }

    public String summary(long descriptionId) {
        try {
            return store.findSummary(descriptionId);
        } catch (DataAccessException e) {
            return null;
        }
    }

    private List<VectorLine> search(long descriptionId, float[] vector, int topK, int fromMs, int toMs) {
        try {
            return store.searchLines(descriptionId, embeddingClient.model(), vector, topK, fromMs, toMs).stream()
                    .sorted(Comparator.comparingInt(VectorLine::startMs))
                    .toList();
        } catch (DataAccessException e) {
            log.warn("[CHAT] 줄 검색 실패, 지금 자료만으로 답함: {}", e.getMessage());
            return List.of();
        }
    }
}
