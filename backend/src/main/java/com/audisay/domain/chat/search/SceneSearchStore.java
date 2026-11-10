package com.audisay.domain.chat.search;

import com.audisay.domain.description.service.DubLines;
import com.audisay.domain.description.service.ScreenTextTiming;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * scene_search_lines·scene_search_indexes 읽기·쓰기. vector 칸 때문에 JPA 엔티티 없이 SQL로 다룬다(ddl-auto validate 유지).
 * 텍스트는 원본 그대로 저장한다(공백을 다듬으면 수정 감지가 늘 "바뀜"으로 본다).
 */
@Repository
@RequiredArgsConstructor
public class SceneSearchStore {
    private final NamedParameterJdbcTemplate jdbc;

    public record DescriptionRef(long id, long jobId, String status) {
    }

    public Optional<DescriptionRef> findDescription(long descriptionId) {
        return jdbc.query("SELECT id, job_id, status FROM descriptions WHERE id = :id",
                        new MapSqlParameterSource("id", descriptionId),
                        (rs, i) -> new DescriptionRef(rs.getLong("id"), rs.getLong("job_id"), rs.getString("status")))
                .stream().findFirst();
    }

    /**
     * 장면 찾기가 읽는 자료와 같은 네 종류. 빈 글은 뺀다. 외국어 대사를 읽어 주는 해설 문장(DubLines)은 대사 줄과 같은 글이라 뺀다.
     * 화면 글자는 시각이 장면 시작이라 해설·대사가 읽은 시각으로 옮긴다(ScreenTextTiming, 못 찾으면 장면 시작)
     */
    public List<SceneSourceLine> readSources(long descriptionId) {
        MapSqlParameterSource params = new MapSqlParameterSource("id", descriptionId);
        List<SceneSourceLine> lines = new ArrayList<>(jdbc.query("""
                        SELECT 'SCENE' AS source_type, id AS source_id, start_ms, scene_description AS text
                        FROM scenes WHERE description_id = :id
                        UNION ALL
                        SELECT 'NARRATION', id, start_ms, text FROM description_lines WHERE description_id = :id
                        UNION ALL
                        SELECT 'DIALOGUE', id, start_ms, text FROM transcript_segments WHERE description_id = :id
                        """, params,
                (rs, i) -> new SceneSourceLine(rs.getString("source_type"), rs.getLong("source_id"),
                        rs.getInt("start_ms"), rs.getString("text"))));
        Set<Long> dubs = dubLineIds(params);
        lines.removeIf(line -> "NARRATION".equals(line.sourceType()) && dubs.contains(line.sourceId()));
        List<ScreenTextTiming.Line> spoken = lines.stream()
                .filter(line -> !"SCENE".equals(line.sourceType()))
                .map(line -> new ScreenTextTiming.Line(line.startMs(), line.text()))
                .toList();
        lines.addAll(jdbc.query("""
                SELECT id, start_ms, end_ms, COALESCE(headline, full_text) AS text FROM screen_texts WHERE description_id = :id
                """, params, (rs, i) -> {
            String text = rs.getString("text");
            int start = rs.getInt("start_ms");
            Integer at = ScreenTextTiming.estimate(text, start, rs.getInt("end_ms"), spoken);
            return new SceneSourceLine("SCREEN", rs.getLong("id"), at == null ? start : at, text);
        }));
        return lines.stream()
                .filter(line -> line.text() != null && !line.text().isBlank())
                .sorted(Comparator.comparingInt(SceneSourceLine::startMs).thenComparing(SceneSourceLine::sourceType)
                        .thenComparingLong(SceneSourceLine::sourceId))
                .toList();
    }

    /** 외국어 대사를 한국어로 읽어 주는 해설 문장 id(line_type DIALOGUE, 칸이 생기기 전 해설은 DubLines. 상세도 1만 본다) */
    private Set<Long> dubLineIds(MapSqlParameterSource params) {
        List<DubLines.Spoken> dialogues = jdbc.query("""
                SELECT start_ms, end_ms, text FROM transcript_segments WHERE description_id = :id
                """, params, (rs, i) -> {
            int start = rs.getInt("start_ms");
            Integer end = rs.getObject("end_ms", Integer.class);
            return new DubLines.Spoken(start, end == null ? start : end, rs.getString("text"));
        });
        Set<Long> ids = new HashSet<>(jdbc.query("""
                SELECT id, start_ms, text, line_type FROM description_lines WHERE description_id = :id AND detail_level = 1
                """, params, (rs, i) -> "DIALOGUE".equals(rs.getString("line_type"))
                || DubLines.isDub(rs.getInt("start_ms"), 1, rs.getString("text"), dialogues) ? rs.getLong("id") : null));
        ids.remove(null);
        return ids;
    }

    /**
     * 색인을 맡는다. 상태 행이 없거나, PENDING이 아니거나, PENDING이 stuckBefore보다 오래됐으면 PENDING으로 바꾸고 true.
     * 다른 곳(공개 직후 색인·스케줄러)이 막 맡은 해설이면 false
     */
    public boolean claim(long descriptionId, String model, Instant stuckBefore) {
        return !jdbc.queryForList("""
                INSERT INTO scene_search_indexes (description_id, model, status, line_count, updated_at)
                VALUES (:id, :model, 'PENDING', 0, now())
                ON CONFLICT (description_id) DO UPDATE
                SET status = 'PENDING', model = EXCLUDED.model, error_code = NULL, updated_at = now()
                WHERE scene_search_indexes.status <> 'PENDING' OR scene_search_indexes.updated_at < :stuckBefore
                RETURNING description_id
                """, new MapSqlParameterSource()
                .addValue("id", descriptionId)
                .addValue("model", model)
                .addValue("stuckBefore", Timestamp.from(stuckBefore)), Long.class).isEmpty();
    }

    /** 줄을 모두 바꾸고 DONE. 호출한 쪽 트랜잭션 안에서 */
    public void replace(long descriptionId, String model, List<SceneSourceLine> lines, List<float[]> vectors) {
        MapSqlParameterSource id = new MapSqlParameterSource("id", descriptionId);
        jdbc.update("DELETE FROM scene_search_lines WHERE description_id = :id", id);
        SqlParameterSource[] rows = new SqlParameterSource[lines.size()];
        for (int i = 0; i < lines.size(); i++) {
            SceneSourceLine line = lines.get(i);
            rows[i] = new MapSqlParameterSource()
                    .addValue("id", descriptionId)
                    .addValue("sourceType", line.sourceType())
                    .addValue("sourceId", line.sourceId())
                    .addValue("startMs", line.startMs())
                    .addValue("text", line.text())
                    .addValue("model", model)
                    .addValue("embedding", PgVectors.literal(vectors.get(i)));
        }
        if (rows.length > 0) {
            jdbc.batchUpdate("""
                    INSERT INTO scene_search_lines (description_id, source_type, source_id, start_ms, text, model, embedding)
                    VALUES (:id, :sourceType, :sourceId, :startMs, :text, :model, CAST(:embedding AS vector))
                    """, rows);
        }
        jdbc.update("""
                UPDATE scene_search_indexes
                SET status = 'DONE', model = :model, line_count = :count, error_code = NULL, updated_at = now()
                WHERE description_id = :id
                """, new MapSqlParameterSource()
                .addValue("id", descriptionId)
                .addValue("model", model)
                .addValue("count", lines.size()));
    }

    /** 영상 전체 요약(없으면 null) */
    public String findSummary(long descriptionId) {
        return jdbc.query("SELECT summary_text FROM descriptions WHERE id = :id",
                new MapSqlParameterSource("id", descriptionId), (rs, i) -> rs.getString("summary_text"))
                .stream().findFirst().orElse(null);
    }

    public void markFailed(long descriptionId, String errorCode) {
        jdbc.update("""
                UPDATE scene_search_indexes SET status = 'FAILED', error_code = :errorCode, updated_at = now()
                WHERE description_id = :id
                """, new MapSqlParameterSource().addValue("id", descriptionId).addValue("errorCode", errorCode));
    }

    /**
     * 색인할 공개 해설: 상태 행 없음(공개 직후 색인을 놓침·배포 전 공개분) / FAILED가 retryBefore보다 오래됨 /
     * PENDING이 stuckBefore보다 오래됨 / DONE인데 모델이 다르거나 색인한 해설 문장 글이 지금 글과 다름(관리자 수정).
     * 색인에 없는 해설 문장은 보지 않는다: 외국어 대사를 읽어 주는 문장(DubLines)은 일부러 색인하지 않아
     * "없음"으로 보면 5분마다 다시 색인한다. 해설 문장은 공개 뒤 새로 생기지 않고 글만 고쳐진다
     */
    public List<Long> findCandidates(String model, Instant retryBefore, Instant stuckBefore, int limit) {
        return jdbc.queryForList("""
                SELECT d.id FROM descriptions d
                LEFT JOIN scene_search_indexes i ON i.description_id = d.id
                WHERE d.status = 'PUBLISHED' AND (
                    i.description_id IS NULL
                    OR (i.status = 'FAILED' AND i.updated_at < :retryBefore)
                    OR (i.status = 'PENDING' AND i.updated_at < :stuckBefore)
                    OR (i.status = 'DONE' AND (i.model <> :model OR EXISTS (
                        SELECT 1 FROM scene_search_lines s
                        JOIN description_lines l ON l.id = s.source_id AND l.description_id = s.description_id
                        WHERE s.description_id = d.id AND s.source_type = 'NARRATION' AND s.text <> l.text)))
                )
                ORDER BY d.id
                LIMIT :limit
                """, new MapSqlParameterSource()
                .addValue("model", model)
                .addValue("retryBefore", Timestamp.from(retryBefore))
                .addValue("stuckBefore", Timestamp.from(stuckBefore))
                .addValue("limit", limit), Long.class);
    }

    /** 이 모델로 색인된 줄이 하나라도 있는지 */
    public boolean hasLines(long descriptionId, String model) {
        return Boolean.TRUE.equals(jdbc.queryForObject("""
                SELECT EXISTS (SELECT 1 FROM scene_search_lines WHERE description_id = :id AND model = :model)
                """, new MapSqlParameterSource().addValue("id", descriptionId).addValue("model", model), Boolean.class));
    }

    /** 질문 벡터와 코사인 거리가 가까운 줄 topK개. 영상 하나 안(수백 줄)이라 인덱스 없이 전부 비교한다 */
    public List<VectorLine> searchLines(long descriptionId, String model, float[] query, int topK) {
        return searchLines(descriptionId, model, query, topK, 0, Integer.MAX_VALUE);
    }

    /** searchLines와 같되 fromMs ≤ start_ms < toMs 인 줄만(질문 답변: 지금 자료보다 앞 / 질문 시각 뒤) */
    public List<VectorLine> searchLines(long descriptionId, String model, float[] query, int topK, int fromMs, int toMs) {
        return jdbc.query("""
                        SELECT source_type, source_id, start_ms, text, 1 - (embedding <=> CAST(:query AS vector)) AS similarity
                        FROM scene_search_lines
                        WHERE description_id = :id AND model = :model AND start_ms >= :fromMs AND start_ms < :toMs
                        ORDER BY embedding <=> CAST(:query AS vector)
                        LIMIT :topK
                        """, new MapSqlParameterSource()
                        .addValue("id", descriptionId)
                        .addValue("model", model)
                        .addValue("query", PgVectors.literal(query))
                        .addValue("topK", topK)
                        .addValue("fromMs", fromMs)
                        .addValue("toMs", toMs),
                (rs, i) -> new VectorLine(rs.getString("source_type"), rs.getLong("source_id"), rs.getInt("start_ms"),
                        rs.getString("text"), rs.getDouble("similarity")));
    }

    /**
     * 질문 답변 RAG: centersMs 각 시각 앞뒤 radiusMs 안에 있는 줄(start_ms < toMs)을 시간순으로(similarity 0).
     * 줄 단위로 찾으면 "감독 인터뷰가 시작된다"(해설)와 감독이 한 말(대사)이 갈라지므로, 찾은 줄 옆 줄을 함께 붙일 때 쓴다
     */
    public List<VectorLine> linesAround(long descriptionId, String model, List<Integer> centersMs, int radiusMs, int toMs) {
        if (centersMs.isEmpty()) {
            return List.of();
        }
        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("id", descriptionId)
                .addValue("model", model)
                .addValue("toMs", toMs);
        List<String> ranges = new ArrayList<>();
        for (int i = 0; i < centersMs.size(); i++) {
            int center = centersMs.get(i);
            ranges.add("start_ms BETWEEN :from" + i + " AND :to" + i);
            params.addValue("from" + i, Math.max(0, center - radiusMs));
            params.addValue("to" + i, center + radiusMs);
        }
        return jdbc.query("""
                        SELECT source_type, source_id, start_ms, text
                        FROM scene_search_lines
                        WHERE description_id = :id AND model = :model AND start_ms < :toMs AND (%s)
                        ORDER BY start_ms, id
                        """.formatted(String.join(" OR ", ranges)), params,
                (rs, i) -> new VectorLine(rs.getString("source_type"), rs.getLong("source_id"), rs.getInt("start_ms"),
                        rs.getString("text"), 0));
    }

    /** 질문 답변 RAG: toMs까지 끝난 장면(목차) 제목을 순서대로. 끝난 장면만이라 뒤 내용이 담기지 않는다 */
    public List<ChapterTitle> chapterTitlesBefore(long descriptionId, int toMs) {
        return jdbc.query("""
                        SELECT start_ms, title FROM chapters
                        WHERE description_id = :id AND end_ms <= :toMs
                        ORDER BY chapter_index
                        """, new MapSqlParameterSource().addValue("id", descriptionId).addValue("toMs", toMs),
                (rs, i) -> new ChapterTitle(rs.getInt("start_ms"), rs.getString("title")));
    }

    /**
     * 공개 해설이 아닌데, 같은 영상의 공개 해설이 createdBefore보다 먼저 만들어진 해설의 색인을 지운다(재생성 뒤 보관 기간이 지남).
     *
     * @return 지운 줄 수
     */
    public int deleteArchived(Instant createdBefore) {
        MapSqlParameterSource params = new MapSqlParameterSource("before", Timestamp.from(createdBefore));
        String target = """
                SELECT d.id FROM descriptions d
                WHERE d.status <> 'PUBLISHED' AND EXISTS (
                    SELECT 1 FROM descriptions p
                    WHERE p.video_id = d.video_id AND p.status = 'PUBLISHED' AND p.created_at < :before)
                """;
        int lines = jdbc.update("DELETE FROM scene_search_lines WHERE description_id IN (" + target + ")", params);
        jdbc.update("DELETE FROM scene_search_indexes WHERE description_id IN (" + target + ")", params);
        return lines;
    }
}
