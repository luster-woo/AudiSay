package com.audisay.domain.chat.service;

import com.audisay.domain.chat.dto.request.ChatMessageRequest;
import com.audisay.domain.chat.dto.response.ChatMessageResponse;
import com.audisay.domain.chat.dto.response.ChatResult;
import com.audisay.domain.chat.entity.ChatIntent;
import com.audisay.domain.chat.entity.ChatLog;
import com.audisay.domain.chat.intent.ClassifiedIntent;
import com.audisay.domain.chat.intent.LlmIntentClassifier;
import com.audisay.domain.chat.intent.RuleIntentClassifier;
import com.audisay.domain.chat.intent.SettingStepResolver;
import com.audisay.domain.chat.ratelimit.ChatRateLimiter;
import com.audisay.domain.chat.repository.ChatLogRepository;
import com.audisay.domain.chat.seek.KeywordSceneScorer.Hit;
import com.audisay.domain.chat.seek.SceneSeeker;
import com.audisay.domain.chat.tuning.ChatTuningProperties;
import com.audisay.domain.description.service.DescriptionService;
import com.audisay.domain.description.service.VideoAccessValidator;
import com.audisay.domain.video.entity.Video;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import com.audisay.global.security.AuthUser;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;

/**
 * 챗봇 입력(발화 분석). 규칙으로 먼저 분류하고 안 되면 LLM. LLM 호출은 DB 트랜잭션 밖에서 한다.
 * 챗봇 기록은 LLM 호출 기록(ai_call_logs.chat_log_id)을 걸 수 있게 분류 전에 먼저 저장한다
 */
@Service
@RequiredArgsConstructor
public class ChatMessageService {
    static final String UNKNOWN_MESSAGE = "다시 말씀해 주세요.";
    static final String OUTSIDE_VIDEO_MESSAGE = "영상을 연 뒤에 질문해 주세요.";
    static final String IN_VIDEO_SEARCH_MESSAGE = "다른 영상은 검색 화면에서 찾아 주세요.";
    static final String SCENE_NOT_FOUND_MESSAGE = "그런 장면을 찾지 못했어요. 다르게 말씀해 주세요.";
    static final String SCENE_SEARCH_SLOW_MESSAGE = "지금은 장면을 찾는 데 시간이 오래 걸려요. 잠시 뒤 다시 말씀해 주세요.";
    private static final Set<ChatIntent> VIDEO_ONLY = EnumSet.of(ChatIntent.QUESTION, ChatIntent.SCENE_NOW,
            ChatIntent.SEEK_TIME, ChatIntent.SEEK_SCENE, ChatIntent.RECAP);
    /** 장면 찾기는 해설이 없으면 에러 대신 "못 찾음" 안내(명세) */
    private static final Set<ChatIntent> NEEDS_DESCRIPTION = EnumSet.of(ChatIntent.QUESTION, ChatIntent.SCENE_NOW,
            ChatIntent.RECAP);
    private static final int END_MARGIN_MS = 3000;

    private final ChatLogRepository chatLogRepository;
    private final RuleIntentClassifier ruleClassifier;
    private final LlmIntentClassifier llmClassifier;
    private final SettingStepResolver settingStepResolver;
    private final SceneSeeker sceneSeeker;
    private final ChatRateLimiter rateLimiter;
    private final ChatTuningProperties tuning;
    private final VideoAccessValidator videoAccessValidator;
    private final DescriptionService descriptionService;
    private final TransactionTemplate transactionTemplate;
    private final MeterRegistry meterRegistry;

    public ChatMessageResponse receive(AuthUser authUser, ChatMessageRequest request) {
        long deadlineNanos = System.nanoTime() + SceneSeeker.RECEIVE_BUDGET.toNanos();
        rateLimiter.acquireRequest(authUser.userId());
        Video video = request.videoId() == null ? null
                : videoAccessValidator.getAccessibleVideo(authUser, request.videoId());
        Long descriptionId = video == null ? null
                : descriptionService.resolveForChat(video.getId(), request.descriptionId()).orElse(null);
        Integer videoTimeMs = video == null ? null : request.videoTimeMs();
        ChatLog chatLog = transactionTemplate.execute(status -> chatLogRepository.save(ChatLog.receive(
                authUser.userId(), video == null ? null : video.getId(), descriptionId, videoTimeMs,
                request.inputMode(), request.utterance().strip())));

        long startedAt = System.nanoTime();
        ClassifiedIntent classified = tuning.intentRules() ? ruleClassifier.classify(chatLog.getUtterance()) : null;
        String source = classified != null ? "RULE" : "LLM";
        if (classified == null) {
            rateLimiter.acquireLlm(authUser.userId());
            classified = llmClassifier.classify(chatLog.getUtterance(), chatLog.getId());
        }
        classified = settingStepResolver.resolve(classified, authUser.userId());
        Duration latency = Duration.ofNanos(System.nanoTime() - startedAt);

        ChatIntent intent = classified.intent();
        Integer targetMs = intent == ChatIntent.SEEK_TIME && video != null ? seekTarget(classified, video, videoTimeMs) : null;
        transactionTemplate.executeWithoutResult(status -> chatLogRepository.findById(chatLog.getId()).ifPresent(log -> {
            log.classify(intent, (int) latency.toMillis());
            if (targetMs != null) {
                log.target(targetMs, null, null);
            }
        }));
        meterRegistry.timer("audisay.chat.intent", "intent", intent.name(), "source", source).record(latency);

        ChatResult result = result(classified, chatLog.getId(), video, descriptionId, targetMs);
        if (intent == ChatIntent.SEEK_SCENE && video != null && descriptionId != null) {
            result = seekScene(authUser.userId(), classified.query(), chatLog.getId(), descriptionId, videoTimeMs,
                    deadlineNanos);
        }
        return new ChatMessageResponse(chatLog.getId(), chatLog.getInputMode(), chatLog.getUtterance(), intent, result);
    }

    /** 장면 후보 수 상한 (FE useAsk.MAX_CANDIDATES 와 같다) */
    static final int MAX_CANDIDATES = 3;

    /** 하나면 그곳으로(targetMs·chapterId), 여럿이면 후보 3개까지(지금 이후부터 시간순), 없으면 안내. 하나일 때만 이동 시각을 기록 */
    private ChatResult seekScene(Long userId, String query, Long chatLogId, Long descriptionId, Integer videoTimeMs,
                                 long deadlineNanos) {
        SceneSeeker.Outcome outcome = sceneSeeker.seek(userId, descriptionId, query, chatLogId, videoTimeMs, deadlineNanos);
        List<Hit> hits = outcome.hits();
        Hit single = hits.size() == 1 ? hits.get(0) : null;
        if (outcome.source() != null) {
            transactionTemplate.executeWithoutResult(status -> chatLogRepository.findById(chatLogId).ifPresent(log ->
                    log.target(single == null ? null : single.targetMs(),
                            single == null ? null : single.scene().chapterId(), outcome.source())));
        }
        // 후보는 3개까지만 (번호를 기억할 수 있게, 낭독이 길어지지 않게). 지금 이후부터 시간순이라 가까운 것이 남는다
        List<ChatResult.SceneCandidate> candidates = hits.stream()
                .limit(MAX_CANDIDATES)
                .map(h -> new ChatResult.SceneCandidate(h.scene().chapterId(), h.scene().title(), h.targetMs(), h.snippet()))
                .toList();
        if (single != null) {
            return ChatResult.seekScene(single.targetMs(), single.scene().chapterId(), candidates, null);
        }
        if (hits.isEmpty()) {
            return ChatResult.seekScene(null, null, candidates,
                    outcome.timedOut() ? SCENE_SEARCH_SLOW_MESSAGE : SCENE_NOT_FOUND_MESSAGE);
        }
        return ChatResult.seekScene(null, null, candidates, null);
    }

    private ChatResult result(ClassifiedIntent classified, Long chatLogId, Video video, Long descriptionId,
                              Integer targetMs) {
        ChatIntent intent = classified.intent();
        if (video == null && VIDEO_ONLY.contains(intent)) {
            return ChatResult.message(OUTSIDE_VIDEO_MESSAGE);
        }
        if (video != null && intent == ChatIntent.SEARCH_VIDEO) {
            return ChatResult.message(IN_VIDEO_SEARCH_MESSAGE);
        }
        if (descriptionId == null && NEEDS_DESCRIPTION.contains(intent)) {
            throw new BusinessException(ErrorCode.DESCRIPTION_NOT_FOUND, "아직 해설이 없어요.");
        }
        return switch (intent) {
            case QUESTION, SCENE_NOW, RECAP -> ChatResult.answerStream(chatLogId);
            case SEEK_TIME -> ChatResult.seekTime(targetMs);
            case SEEK_SCENE -> ChatResult.seekScene(null, null, List.of(), SCENE_NOT_FOUND_MESSAGE);
            case SETTING -> ChatResult.setting(classified.settingKey(), classified.settingValue(), classified.message());
            case ACTION -> ChatResult.action(classified.actionCode());
            case SEARCH_VIDEO -> ChatResult.searchVideo(classified.query());
            case UNKNOWN -> ChatResult.message(classified.message() != null ? classified.message() : UNKNOWN_MESSAGE);
        };
    }

    /** 영상 길이 안으로 자른다. 상대 이동은 입력 시각 기준(없으면 0), "끝으로"는 끝 3초 전 */
    static Integer seekTarget(ClassifiedIntent classified, Video video, Integer videoTimeMs) {
        // long으로 계산한다("500시간 뒤로"처럼 큰 상대 이동이 int를 넘어 음수 → 처음으로 가지 않게)
        Long durationMs = video.getDurationSec() == null ? null : video.getDurationSec() * 1000L;
        long target;
        if (classified.toEnd()) {
            if (durationMs == null) {
                return null;
            }
            target = durationMs - END_MARGIN_MS;
        } else if (classified.relativeMs() != null) {
            target = (videoTimeMs == null ? 0L : videoTimeMs.longValue()) + classified.relativeMs();
        } else {
            target = classified.targetMs();
        }
        target = Math.max(0L, target);
        target = Math.min(target, durationMs == null ? Integer.MAX_VALUE : durationMs);
        return (int) target;
    }
}
