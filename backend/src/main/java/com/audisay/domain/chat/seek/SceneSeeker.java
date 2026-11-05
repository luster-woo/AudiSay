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
import com.audisay.global.external.llm.GmsProperties;
import com.audisay.global.external.llm.LlmPurpose;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.List;

/**
 * 장면 찾기(SEEK_SCENE): 키워드 검색(0크레딧)으로 찾으면 그대로 — 단 후보가 여럿이고 대사 한 줄에서만 찾은 후보가 섞였거나,
 * 검색어 낱말을 다 못 맞힌 후보가 있거나 한 글자 낱말("우", "타")로 찾았으면(seek-partial-verify, 애매함) LLM이 한 번 거른다.
 * 애매한 후보가 모두 걸러지면 LLM이 목차에서 다시 고른다.
 * 키워드로 못 찾으면 LLM이 고른다.
 * 지표 audisay.chat.seek{source=KEYWORD/LLM/NONE, result=single/multiple/none, verified} — 키워드로 처리한 비율, 거르기 횟수
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class SceneSeeker {
    /**
     * 챗봇 입력 하나의 응답 예산. FE가 15초(axios)에 끊으므로 그 전에 답한다: LLM 한 번(seek 시간 제한)을 다 기다릴 수
     * 없으면 그 단계를 건너뛴다(거르기는 생략, 다시 고르기는 못 찾음)
     */
    public static final Duration RECEIVE_BUDGET = Duration.ofSeconds(13);

    private final SceneTextReader sceneTextReader;
    private final KeywordSceneScorer scorer;
    private final LlmSceneSelector selector;
    private final LlmHitVerifier verifier;
    private final ChatRateLimiter rateLimiter;
    private final ChatTuningProperties tuning;
    private final MeterRegistry meterRegistry;
    private final GmsProperties gmsProperties;

    /**
     * @param source   찾은 방법(못 찾았으면 null)
     * @param timedOut 응답 시간 예산이 모자라 LLM으로 고르지 못했다(못 찾은 것과 안내를 다르게)
     */
    public record Outcome(List<Hit> hits, SeekSource source, boolean timedOut) {
        public Outcome(List<Hit> hits, SeekSource source) {
            this(hits, source, false);
        }
    }

    public Outcome seek(Long userId, Long descriptionId, String query, Long chatLogId, Integer nowMs) {
        return seek(userId, descriptionId, query, chatLogId, nowMs, null);
    }

    /** @param deadlineNanos 이 System.nanoTime()까지 답해야 한다(null이면 제한 없음) */
    public Outcome seek(Long userId, Long descriptionId, String query, Long chatLogId, Integer nowMs, Long deadlineNanos) {
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
                // 후보가 너무 많으면 프롬프트·출력 한도를 넘으므로 점수가 높은 MAX_CANDIDATES개만 LLM이 거른다
                List<Hit> candidates = topByScore(hits, nowMs);
                boolean partial = tuning.seekPartialVerify() && (candidates.stream().anyMatch(h -> h.matchedTerms() < termCount)
                        || keyword.terms().stream().anyMatch(t -> t.length() == 1));
                boolean dialogueOnly = keyword.decision() == Decision.MULTIPLE && tuning.seekLlmVerify()
                        && LlmHitVerifier.worthVerifying(candidates);
                if ((partial || dialogueOnly) && hasTimeForLlm(deadlineNanos, "거르기") && tryAcquireLlm(userId)) {
                    hits = deadlineNanos == null ? verifier.verify(query, candidates, chatLogId)
                            : verifier.verify(query, candidates, chatLogId, deadlineNanos);
                    verified = true;
                }
                if (hits.isEmpty() && partial) {
                    if (hasTimeForLlm(deadlineNanos, "다시 고르기")) {
                        rateLimiter.acquireLlm(userId);
                        hits = select(query, scenes, chatLogId, nowMs, deadlineNanos);
                        outcome = new Outcome(hits, hits.isEmpty() ? null : SeekSource.LLM);
                    } else {
                        outcome = new Outcome(List.of(), null, true);
                    }
                } else {
                    outcome = new Outcome(hits, hits.isEmpty() ? null : SeekSource.KEYWORD);
                }
            } else if (hasTimeForLlm(deadlineNanos, "고르기")) {
                rateLimiter.acquireLlm(userId);
                List<Hit> hits = select(query, scenes, chatLogId, nowMs, deadlineNanos);
                outcome = new Outcome(hits, hits.isEmpty() ? null : SeekSource.LLM);
            } else {
                outcome = new Outcome(List.of(), null, true);
            }
        }
        meterRegistry.counter("audisay.chat.seek",
                "source", outcome.source() == null ? "NONE" : outcome.source().name(),
                "result", outcome.hits().isEmpty() ? "none" : outcome.hits().size() == 1 ? "single" : "multiple",
                "verified", String.valueOf(verified))
                .increment();
        return outcome;
    }

    private static List<Hit> topByScore(List<Hit> hits, Integer nowMs) {
        if (hits.size() <= LlmHitVerifier.MAX_CANDIDATES) {
            return hits;
        }
        return KeywordSceneScorer.sortByTime(hits.stream()
                .sorted(java.util.Comparator.comparingDouble(Hit::score).reversed())
                .limit(LlmHitVerifier.MAX_CANDIDATES)
                .toList(), nowMs);
    }

    private List<Hit> select(String query, List<SceneText> scenes, Long chatLogId, Integer nowMs, Long deadlineNanos) {
        return deadlineNanos == null ? selector.select(query, scenes, chatLogId, nowMs)
                : selector.select(query, scenes, chatLogId, nowMs, deadlineNanos);
    }

    private boolean hasTimeForLlm(Long deadlineNanos, String step) {
        if (deadlineNanos == null) {
            return true;
        }
        long remaining = deadlineNanos - System.nanoTime();
        if (remaining >= gmsProperties.timeout(LlmPurpose.SEEK).toNanos()) {
            return true;
        }
        log.info("[CHAT] 응답 시간 예산이 {}ms 남아 장면 {} 생략", remaining / 1_000_000, step);
        return false;
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
