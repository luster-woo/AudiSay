package com.audisay.domain.chat.seek;

import com.audisay.domain.chat.entity.SeekSource;
import com.audisay.domain.chat.ratelimit.ChatRateLimiter;
import com.audisay.domain.chat.seek.KeywordSceneScorer.Decision;
import com.audisay.domain.chat.seek.KeywordSceneScorer.Hit;
import com.audisay.domain.chat.tuning.ChatTuningProperties;
import com.audisay.domain.description.service.SceneText;
import com.audisay.domain.description.service.SceneTextReader;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * 장면 찾기(SEEK_SCENE): 키워드 검색(0크레딧)으로 찾으면 그대로 — 단 후보가 여럿이고 대사 한 줄에서만 찾은 후보가 섞였거나,
 * 검색어 낱말을 다 못 맞힌 후보가 있거나 한 글자 낱말("우", "타")로 찾았으면(seek-partial-verify, 애매함) LLM이 한 번 거른다.
 * 애매한 후보가 모두 걸러지면 LLM이 목차에서 다시 고른다.
 * 키워드로 못 찾으면 LLM이 고른다.
 * 지표 audisay.chat.seek{source=KEYWORD/LLM/NONE, result=single/multiple/none, verified} — 키워드로 처리한 비율, 거르기 횟수
 */
@Component
@RequiredArgsConstructor
public class SceneSeeker {
    private final SceneTextReader sceneTextReader;
    private final KeywordSceneScorer scorer;
    private final LlmSceneSelector selector;
    private final LlmHitVerifier verifier;
    private final ChatRateLimiter rateLimiter;
    private final ChatTuningProperties tuning;
    private final MeterRegistry meterRegistry;

    /** @param source 찾은 방법(못 찾았으면 null) */
    public record Outcome(List<Hit> hits, SeekSource source) {
    }

    public Outcome seek(Long userId, Long descriptionId, String query, Long chatLogId, Integer nowMs) {
        List<SceneText> scenes = sceneTextReader.read(descriptionId);
        boolean verified = false;
        Outcome outcome;
        if (scenes.isEmpty()) {
            outcome = new Outcome(List.of(), null);
        } else {
            KeywordSceneScorer.Result keyword = tuning.seekKeyword() ? scorer.score(query, scenes, nowMs) : null;
            if (keyword != null && keyword.decision() != Decision.NONE) {
                List<Hit> hits = keyword.chosen();
                int termCount = keyword.terms().size();
                boolean partial = tuning.seekPartialVerify() && (hits.stream().anyMatch(h -> h.matchedTerms() < termCount)
                        || keyword.terms().stream().anyMatch(t -> t.length() == 1));
                boolean dialogueOnly = keyword.decision() == Decision.MULTIPLE && tuning.seekLlmVerify()
                        && LlmHitVerifier.worthVerifying(hits);
                if ((partial || dialogueOnly) && tryAcquireLlm(userId)) {
                    hits = verifier.verify(query, hits, chatLogId);
                    verified = true;
                }
                if (hits.isEmpty() && partial) {
                    rateLimiter.acquireLlm(userId);
                    hits = selector.select(query, scenes, chatLogId, nowMs);
                    outcome = new Outcome(hits, hits.isEmpty() ? null : SeekSource.LLM);
                } else {
                    outcome = new Outcome(hits, hits.isEmpty() ? null : SeekSource.KEYWORD);
                }
            } else {
                rateLimiter.acquireLlm(userId);
                List<Hit> hits = selector.select(query, scenes, chatLogId, nowMs);
                outcome = new Outcome(hits, hits.isEmpty() ? null : SeekSource.LLM);
            }
        }
        meterRegistry.counter("audisay.chat.seek",
                "source", outcome.source() == null ? "NONE" : outcome.source().name(),
                "result", outcome.hits().isEmpty() ? "none" : outcome.hits().size() == 1 ? "single" : "multiple",
                "verified", String.valueOf(verified))
                .increment();
        return outcome;
    }

    /** 거르기는 덤이라 LLM 호출 한도에 걸리면 거르지 않고 넘어간다 */
    private boolean tryAcquireLlm(Long userId) {
        try {
            rateLimiter.acquireLlm(userId);
            return true;
        } catch (BusinessException e) {
            if (e.getErrorCode() == ErrorCode.CHAT_RATE_LIMIT) {
                return false;
            }
            throw e;
        }
    }
}
