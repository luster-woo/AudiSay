package com.audisay.global.external.embedding;

import java.util.List;

/**
 * 글 → 벡터. 실패하면 LlmException(UNAVAILABLE·TIMEOUT·RATE_LIMIT·INVALID). 호출마다 ai_call_logs(EMBED)에 남긴다.
 */
public interface EmbeddingClient {

    /** 해설 줄 색인. 글 순서대로 벡터를 돌려준다 */
    List<float[]> embedDocuments(List<String> texts, Long jobId);

    /** 장면 찾기 질문 하나 */
    float[] embedQuery(String text, Long chatLogId);

    /** scene_search_lines.model에 남길 이름 */
    String model();
}
