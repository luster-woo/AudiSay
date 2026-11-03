package com.audisay.domain.chat.seek;

import com.audisay.domain.chat.seek.KeywordSceneScorer.Hit;
import com.audisay.domain.description.service.SceneText;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.external.llm.LlmClient;
import com.audisay.global.external.llm.LlmException;
import com.audisay.global.external.llm.LlmPurpose;
import com.audisay.global.external.llm.LlmRequest;
import com.audisay.global.external.llm.LlmResult;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.util.List;

/**
 * 키워드로 못 찾은 장면을 LLM(gemini-3.1-flash-lite, 장애 때 claude-haiku-5-5)이 목차와 장면별 발췌를 보고 고른다.
 * 낱말이 달라도 뜻이 같은 장면("안타" ↔ "공을 쳐서 1루로")을 찾는 게 목적. 고른 장면 안에서는 검색어와 가장 많이 겹치는 문장 시각으로 간다.
 * 프롬프트는 모델 비교 스파이크 SEEK_SYSTEM에 발췌·여러 번 나오는 장면·근거 없으면 고르지 않기를 더한 것
 */
@Component
@RequiredArgsConstructor
public class LlmSceneSelector {
    static final int MAX_OUTPUT_TOKENS = 200;
    static final String SYSTEM = """
            시각장애인이 영상에서 찾아 달라고 한 장면을 장면 목차에서 고르세요. 목차 한 줄은 "번호. 시작 시각 제목 / 요약 / 키워드 / 발췌"입니다.
            - 요청과 맞는 장면 번호를 잘 맞는 순서로 고르세요. 같은 일이 여러 번 나오면(안타, 골, 웃는 장면 등) 맞는 장면을 모두 고르세요.
            - 낱말이 달라도 뜻이 같으면 맞는 장면입니다(예: "안타"와 "공을 쳐서 1루로 달려갑니다").
            - 목차와 발췌에 근거가 없으면 고르지 마세요. 짐작으로 고르지 마세요.
            - 설명 없이 JSON 한 줄만 답하세요: {"n": [번호, ...]} 맞는 장면이 없으면 {"n": []}""";

    private final LlmClient llmClient;
    private final ObjectMapper objectMapper;
    private final KeywordSceneScorer scorer;

    /**
     * @return 고른 장면(여럿이면 지금 시각 이후부터 시간순), 없으면 빈 목록. LLM 장애·한도·시간 초과는 CHAT_005·007·006
     */
    public List<Hit> select(String query, List<SceneText> scenes, Long chatLogId, Integer nowMs) {
        if (scenes.isEmpty()) {
            return List.of();
        }
        String user = "[장면 목차]\n" + SceneToc.build(scenes) + "\n사용자 요청: " + query;
        LlmResult result;
        try {
            result = llmClient.generate(LlmRequest.json(LlmPurpose.SEEK, SYSTEM, user, MAX_OUTPUT_TOKENS)
                    .withChatLogId(chatLogId));
        } catch (LlmException e) {
            if (e.getKind() == LlmException.Kind.BLOCKED) {
                return List.of();
            }
            throw new BusinessException(e.getKind().errorCode());
        }
        List<Hit> hits = parse(result.text(), scenes.size()).stream()
                .map(n -> scorer.locate(query, scenes.get(n - 1)))
                .toList();
        return hits.size() <= 1 ? hits : KeywordSceneScorer.sortByTime(hits, nowMs);
    }

    /** {"n": [2, 5]} → [2, 5]. 읽을 수 없으면 빈 목록 */
    List<Integer> parse(String text, int sceneCount) {
        List<Integer> numbers = LlmNumbers.parse(objectMapper, text, "n", sceneCount);
        return numbers == null ? List.of() : numbers;
    }
}
