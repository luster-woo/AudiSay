package com.audisay.domain.chat.search;

import com.audisay.global.external.embedding.EmbeddingClient;
import com.audisay.global.external.llm.LlmException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 질문 답변 RAG(342). 질문을 한 번 임베딩해, 바로 하는 답에는 지금 자료보다 앞의 비슷한 줄을, 뒤 확인에는 질문 시각 뒤의 비슷한 줄을 찾는다.
 * 꺼져 있거나 색인이 없거나 임베딩이 실패하면 null·빈 목록 → 호출한 쪽이 예전 방식으로
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AnswerRetriever {
    /** 찾은 앞 줄 앞뒤로 함께 붙이는 범위. 해설 "감독 인터뷰가 시작된다"와 그 대사·화면 글자는 몇 초 안에 있다 */
    static final int NEIGHBOR_MS = 5_000;
    /** 찾은 줄 + 옆 줄 상한(옆 줄은 찾은 줄에 가까운 것부터) */
    static final int MAX_EARLIER_LINES = 24;
    /** 앞 줄과 함께 넣는 끝난 장면 제목 글자 수 상한(넘으면 최근 장면부터 남김) */
    static final int MAX_TITLE_CHARS = 3_000;

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

    /**
     * start_ms < beforeMs 인 줄 중 비슷한 earlierTopK개에, 각 줄 앞뒤 NEIGHBOR_MS 안의 줄을 더해 시간순으로.
     * 지금 자료보다 앞이라 모두 끝난 장면(스포일러 없음). 옆 줄도 beforeMs 앞만
     */
    public List<VectorLine> before(long descriptionId, float[] vector, int beforeMs) {
        if (vector == null || beforeMs <= 0) {
            return List.of();
        }
        return withNeighbors(descriptionId,
                search(descriptionId, vector, properties.answer().earlierTopK(), 0, beforeMs), beforeMs);
    }

    /** start_ms > afterMs 인 줄 중 비슷한 laterTopK개를 시간순으로 */
    public List<VectorLine> after(long descriptionId, float[] vector, int afterMs) {
        if (vector == null) {
            return List.of();
        }
        return search(descriptionId, vector, properties.answer().laterTopK(), afterMs + 1, Integer.MAX_VALUE);
    }

    /**
     * nowMs까지 끝난 장면 제목(시간순). "디아즈가 실책을 범한다"처럼 회차·순서가 없는 앞 줄을 "10회 말 …" 같은 장면 흐름에 맞추게 한다.
     * 못 읽으면 빈 목록
     */
    public List<ChapterTitle> pastTitles(long descriptionId, int nowMs) {
        List<ChapterTitle> all;
        try {
            all = store.chapterTitlesBefore(descriptionId, nowMs);
        } catch (DataAccessException e) {
            log.warn("[CHAT] 장면 제목 읽기 실패, 앞 줄만으로 답함: {}", e.getMessage());
            return List.of();
        }
        int from = all.size();
        int chars = 0;
        while (from > 0 && chars + all.get(from - 1).title().length() <= MAX_TITLE_CHARS) {
            from--;
            chars += all.get(from).title().length();
        }
        return List.copyOf(all.subList(from, all.size()));
    }

    public String summary(long descriptionId) {
        try {
            return store.findSummary(descriptionId);
        } catch (DataAccessException e) {
            return null;
        }
    }

    /** 줄 단위 검색은 해설("감독 인터뷰가 시작된다")만 찾고 그 대사를 놓치므로 옆 줄을 붙인다. 못 읽으면 찾은 줄만 */
    private List<VectorLine> withNeighbors(long descriptionId, List<VectorLine> hits, int toMs) {
        if (hits.isEmpty()) {
            return hits;
        }
        List<VectorLine> around;
        try {
            around = store.linesAround(descriptionId, embeddingClient.model(),
                    hits.stream().map(VectorLine::startMs).distinct().toList(), NEIGHBOR_MS, toMs);
        } catch (DataAccessException e) {
            log.warn("[CHAT] 옆 줄 읽기 실패, 찾은 줄만으로 답함: {}", e.getMessage());
            return hits;
        }
        Set<String> seen = new HashSet<>();
        hits.forEach(line -> seen.add(key(line)));
        List<VectorLine> merged = new ArrayList<>(hits);
        around.stream()
                .filter(line -> line.startMs() < toMs && seen.add(key(line)))
                .sorted(Comparator.comparingInt(line -> distance(line, hits)))
                .limit(Math.max(0, MAX_EARLIER_LINES - hits.size()))
                .forEach(merged::add);
        return merged.stream().sorted(Comparator.comparingInt(VectorLine::startMs)).toList();
    }

    private static String key(VectorLine line) {
        return line.sourceType() + ":" + line.sourceId();
    }

    private static int distance(VectorLine line, List<VectorLine> hits) {
        return hits.stream().mapToInt(hit -> Math.abs(hit.startMs() - line.startMs())).min().orElse(Integer.MAX_VALUE);
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
