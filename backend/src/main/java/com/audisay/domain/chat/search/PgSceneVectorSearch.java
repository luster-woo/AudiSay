package com.audisay.domain.chat.search;

import com.audisay.global.external.embedding.EmbeddingClient;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.List;

/** 질문 임베딩(3초 제한, ai_call_logs EMBED에 chatLogId로) → scene_search_lines 코사인 거리 순 */
@Component
@RequiredArgsConstructor
public class PgSceneVectorSearch implements SceneVectorSearch {
    private final SceneSearchStore store;
    private final EmbeddingClient embeddingClient;

    @Override
    public boolean ready(long descriptionId) {
        return store.hasLines(descriptionId, embeddingClient.model());
    }

    @Override
    public List<VectorLine> search(long descriptionId, String query, Long chatLogId, int topK) {
        float[] vector = embeddingClient.embedQuery(query, chatLogId);
        return store.searchLines(descriptionId, embeddingClient.model(), vector, topK);
    }
}
