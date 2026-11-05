package com.audisay.domain.chat.search;

import java.util.List;

/**
 * 해설 하나의 줄에서 질문과 비슷한 줄 찾기. 운영은 pgvector(PgSceneVectorSearch), 평가는 메모리.
 */
public interface SceneVectorSearch {

    /** 지금 모델로 색인된 줄이 있는지(없으면 임베딩을 부르지 않고 지금 방식으로) */
    boolean ready(long descriptionId);

    /** 질문을 임베딩해 비슷한 줄 topK개(비슷한 순). 임베딩 실패면 LlmException */
    List<VectorLine> search(long descriptionId, String query, Long chatLogId, int topK);
}
