package com.audisay.domain.chat.seek;

import com.audisay.domain.chat.entity.SeekSource;
import com.audisay.domain.chat.ratelimit.ChatRateLimiter;
import com.audisay.domain.chat.search.SceneSearchProperties;
import com.audisay.domain.chat.search.SceneVectorSearch;
import com.audisay.domain.chat.search.VectorLine;
import com.audisay.domain.chat.seek.KeywordSceneScorer.Decision;
import com.audisay.domain.chat.seek.KeywordSceneScorer.Hit;
import com.audisay.domain.chat.tuning.ChatTuningProperties;
import com.audisay.domain.description.service.SceneText;
import com.audisay.domain.description.service.SceneTextReader;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import com.audisay.global.external.llm.GmsProperties;
import com.audisay.global.external.llm.LlmException;
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
 * RAG(342, audisay.scene-search.search.mode): FALLBACK이면 키워드가 확실하지 않을 때(애매·못 찾음), ALWAYS면 늘 키워드 후보와
 * 벡터 검색 후보를 RRF로 합친 상위 몇 개를 LLM이 확인한다. 색인이 없거나 임베딩이 실패하거나 시간이 모자라면 위 방식으로.
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
    /**
     * LLM 한 번에 남겨 둘 시간을 seek 시간 제한(10초)보다 이만큼 적게 본다. FE는 15초에 끊고 예산은 13초라,
     * 마지막 LLM이 제한을 거의 다 써도 FE 안에 든다. 예전에는 제한을 꽉 채워 요구해서, 분류(1~2초) 뒤에는
     * 실제로 느린 게 없어도 '시간이 오래 걸려요'가 쉽게 나왔다
     */
    static final Duration LLM_SLACK = Duration.ofMillis(1500);
    /** 장면 검색 임베딩 한 번(audisay.embedding.query-timeout). RAG는 이것과 확인 LLM 한 번이 다 남아야 시작한다 */
    static final Duration EMBEDDING_ALLOWANCE = Duration.ofSeconds(3);

    private final SceneTextReader sceneTextReader;
    private final KeywordSceneScorer scorer;
    private final LlmSceneSelector selector;
    private final LlmHitVerifier verifier;
    private final ChatRateLimiter rateLimiter;
    private final ChatTuningProperties tuning;
    private final MeterRegistry meterRegistry;
    private final GmsProperties gmsProperties;
    private final SceneVectorSearch vectorSearch;
    private final SceneSearchProperties searchProperties;

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
            boolean found = keyword != null && keyword.decision() != Decision.NONE;
            // 후보가 너무 많으면 프롬프트·출력 한도를 넘으므로 점수가 높은 MAX_CANDIDATES개만 LLM이 거른다
            List<Hit> candidates = found ? topByScore(keyword.chosen(), nowMs) : List.of();
            boolean partial = found && tuning.seekPartialVerify()
                    && (candidates.stream().anyMatch(h -> h.matchedTerms() < keyword.terms().size())
                    || keyword.terms().stream().anyMatch(t -> t.length() == 1));
            boolean dialogueOnly = found && keyword.decision() == Decision.MULTIPLE && tuning.seekLlmVerify()
                    && LlmHitVerifier.worthVerifying(candidates);
            SceneSearchProperties.Mode mode = searchProperties.search().mode();
            boolean clear = found && !partial && !dialogueOnly;
            Outcome rag = mode == SceneSearchProperties.Mode.ALWAYS || (mode == SceneSearchProperties.Mode.FALLBACK && !clear)
                    ? rag(userId, descriptionId, query, chatLogId, nowMs, deadlineNanos, scenes, keyword) : null;
            if (rag != null) {
                outcome = rag;
                verified = true;
            } else if (found) {
                List<Hit> hits = keyword.chosen();
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
        // "두 번째 골"처럼 순서를 말했으면 찾은 곳 중 시간순으로 그 번째 하나만
        List<Hit> ordered = KeywordSceneScorer.pickOrdinal(query, outcome.hits());
        if (ordered != outcome.hits()) {
            outcome = new Outcome(ordered, outcome.source(), outcome.timedOut());
        }
        meterRegistry.counter("audisay.chat.seek",
                "source", outcome.source() == null ? "NONE" : outcome.source().name(),
                "result", outcome.hits().isEmpty() ? "none" : outcome.hits().size() == 1 ? "single" : "multiple",
                "verified", String.valueOf(verified))
                .increment();
        return outcome;
    }

    /**
     * 키워드 후보와 벡터 검색 후보를 RRF로 합친 상위 candidates개를 LLM이 확인한다(실제로 그 일이 일어난 후보만).
     * 색인이 없거나, 임베딩이 실패하거나(서킷 열림 포함), 응답 시간 예산이 모자라면 null → 지금 방식으로
     */
    private Outcome rag(Long userId, Long descriptionId, String query, Long chatLogId, Integer nowMs, Long deadlineNanos,
                        List<SceneText> scenes, KeywordSceneScorer.Result keyword) {
        SceneSearchProperties.Search search = searchProperties.search();
        // 임베딩 전에 미리 본다: 임베딩까지 하고 나서 'RAG 확인'에 시간이 모자라면, 그 뒤 LLM 고르기 몫까지 써 버려
        // 못 찾음(시간이 오래 걸려요)이 된다. 임베딩 + 확인 한 번이 다 남지 않으면 RAG를 건너뛰고 고르기 몫을 남긴다
        if (!hasTime(deadlineNanos, EMBEDDING_ALLOWANCE.plus(llmNeed()), "RAG") || !vectorSearch.ready(descriptionId)) {
            return null;
        }
        List<VectorLine> lines;
        try {
            lines = vectorSearch.search(descriptionId, query, chatLogId, search.vectorTopK());
        } catch (LlmException e) {
            log.warn("[CHAT] 장면 벡터 검색 실패({}), 키워드·LLM 방식으로: {}", e.getKind(), e.getMessage());
            return null;
        }
        List<Hit> fused = HybridSceneRanker.fuse(keyword == null ? List.<Hit>of() : keyword.hits(), lines, scenes,
                search.candidates());
        if (fused.isEmpty()) {
            return new Outcome(List.of(), null);
        }
        if (!hasTimeForLlm(deadlineNanos, "RAG 확인")) {
            return null;
        }
        rateLimiter.acquireLlm(userId);
        List<Hit> checked = verifier.check(query, fused, chatLogId, deadlineNanos);
        // 확인이 실패하면(LLM 장애·읽을 수 없는 응답) 후보를 다 주지 않고 RRF 1등 하나만
        List<Hit> hits = checked == null ? List.of(fused.get(0)) : KeywordSceneScorer.sortByTime(checked, nowMs);
        if (hits.isEmpty() && keyword != null) {
            // LLM이 하나도 고르지 않아도 목차 제목이 검색어를 다 담은 곳은 준다 — 같은 질문에 LLM 판단이 흔들려 못 찾는 일을 막는다
            // ("9회 말 수비 장면"이 3번 중 1번 못 찾음, 11-06)
            java.util.Map<SceneText, Hit> byScene = new java.util.LinkedHashMap<>();
            keyword.hits().stream().filter(h -> KeywordSceneScorer.titleCovers(keyword.terms(), h.scene()))
                    .forEach(h -> byScene.putIfAbsent(h.scene(), h));
            hits = KeywordSceneScorer.sortByTime(List.copyOf(byScene.values()), nowMs);
        }
        return new Outcome(hits, hits.isEmpty() ? null : SeekSource.RAG);
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
        return hasTime(deadlineNanos, llmNeed(), step);
    }

    /** LLM 한 번에 필요한 시간: seek 시간 제한 - LLM_SLACK (최소 1초) */
    private Duration llmNeed() {
        Duration need = gmsProperties.timeout(LlmPurpose.SEEK).minus(LLM_SLACK);
        return need.compareTo(Duration.ofSeconds(1)) < 0 ? Duration.ofSeconds(1) : need;
    }

    private boolean hasTime(Long deadlineNanos, Duration need, String step) {
        if (deadlineNanos == null) {
            return true;
        }
        long remaining = deadlineNanos - System.nanoTime();
        if (remaining >= need.toNanos()) {
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
