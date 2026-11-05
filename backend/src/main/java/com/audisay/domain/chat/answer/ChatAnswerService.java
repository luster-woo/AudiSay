package com.audisay.domain.chat.answer;

import com.audisay.domain.chat.dto.response.AnswerStreamEvent.Done;
import com.audisay.domain.chat.dto.response.AnswerStreamEvent.Failed;
import com.audisay.domain.chat.entity.AnswerSource;
import com.audisay.domain.chat.entity.ChatIntent;
import com.audisay.domain.chat.entity.ChatLog;
import com.audisay.domain.chat.ratelimit.ChatRateLimiter;
import com.audisay.domain.chat.repository.ChatLogRepository;
import com.audisay.domain.chat.tuning.ChatTuningProperties;
import com.audisay.domain.description.service.AnswerContext;
import com.audisay.domain.description.service.AnswerContextReader;
import com.audisay.domain.description.service.FutureContext;
import com.audisay.domain.description.service.RecapContext;
import com.audisay.domain.description.service.RecapReader;
import com.audisay.domain.description.service.VideoAccessValidator;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import com.audisay.global.external.ai.AiServerClient;
import com.audisay.global.external.ai.AiServerException;
import com.audisay.global.external.ai.TtsResult;
import com.audisay.global.external.llm.LlmClient;
import com.audisay.global.external.llm.LlmException;
import com.audisay.global.external.llm.LlmPurpose;
import com.audisay.global.external.llm.LlmRequest;
import com.audisay.global.external.llm.LlmResult;
import com.audisay.global.security.AuthUser;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * 질문 답변 SSE(GET /chat/messages/{chatLogId}/stream). 저장 자료만 근거로 LLM(gemini-3.1-flash-lite) 스트리밍 →
 * 글자 조각은 delta, 문장이 끝나면 AI /internal/tts(Supertonic) 음성과 함께 sentence, 끝나면 done(실패면 error).
 * SCENE_NOW는 장면 제목을 먼저 읽고 LLM이 지금 화면을 잇는다(LLM을 못 쓰면 장면 설명으로).
 * 연결이 끊기면 LLM 스트림·남은 음성을 멈추고, 어느 경우든 받은 데까지 chat_logs에 남긴다.
 * 바로 하는 답은 질문한 시각까지 자료만(answer-past-only). 답하지 못하면 뒤쪽 자료에 답이 있는지 LLM이 확인해(answer-future-check)
 * "지금 이후에 나와요, 들으시겠어요?"를 읽고 done.futureAvailable=true → includeFuture=true 재구독이면 뒤 자료까지 넣어 답한다(FUTURE)
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ChatAnswerService {
    static final String NO_DESCRIPTION = "아직 해설이 없어서 답할 수 없어요.";
    private static final Duration IN_PROGRESS_MARGIN = Duration.ofMinutes(3);
    private static final Duration HEARTBEAT_INTERVAL = Duration.ofSeconds(15);

    private final ChatLogRepository chatLogRepository;
    private final AnswerContextReader answerContextReader;
    private final AnswerPrompt answerPrompt;
    private final LlmClient llmClient;
    private final AiServerClient aiServerClient;
    private final ChatRateLimiter rateLimiter;
    private final AnswerInProgress inProgress;
    private final ChatAnswerExecutors executors;
    private final ChatAnswerProperties properties;
    private final TransactionTemplate transactionTemplate;
    private final MeterRegistry meterRegistry;
    private final ChatTuningProperties tuning;
    private final FutureOffer futureOffer;
    private final RecapReader recapReader;
    private final VideoAccessValidator videoAccessValidator;

    /**
     * 권한·상태를 먼저 확인하고(실패는 JSON 에러), 답변은 답변 스레드에서 만든다. 이미 끝난 답변이면 done만 보내고 닫는다
     */
    public SseEmitter subscribe(AuthUser authUser, Long chatLogId) {
        return subscribe(authUser, chatLogId, false);
    }

    /** @param includeFuture "지금 이후 내용 들을게요"(futureAvailable였던 질문만, 한 번) */
    public SseEmitter subscribe(AuthUser authUser, Long chatLogId, boolean includeFuture) {
        ChatLog chatLog = chatLogRepository.findById(chatLogId)
                .orElseThrow(() -> new BusinessException(ErrorCode.CHAT_LOG_NOT_FOUND));
        if (!chatLog.getUserId().equals(authUser.userId())) {
            throw new BusinessException(ErrorCode.FORBIDDEN, "본인의 질문만 볼 수 있습니다.");
        }
        if (!chatLog.isAnswerable()) {
            throw new BusinessException(ErrorCode.NOT_ANSWERABLE_INPUT);
        }
        if (chatLog.getVideoId() != null) {
            // 질문한 뒤 영상이 비공개로 바뀌었으면 답(다시 만들기·뒤 내용 포함)도 받지 못한다(기록 조회와 같은 기준)
            videoAccessValidator.getAccessibleVideo(authUser, chatLog.getVideoId());
        }
        if (includeFuture && !futureOffered(chatLog)) {
            throw new BusinessException(ErrorCode.FUTURE_NOT_AVAILABLE);
        }
        SseEmitter emitter = newEmitter();
        AnswerSink sink = new AnswerSink(emitter);
        if (!includeFuture && chatLog.isAnswered()) {
            return sendAnswered(sink, emitter, chatLog);
        }
        // 서버가 죽었을 때만 TTL로 풀린다(정상이면 finish). 답변 스레드는 SSE가 닫힌 뒤에도 조금 더 돌 수 있어 넉넉히
        if (!inProgress.start(chatLogId, properties.streamTimeout().plus(IN_PROGRESS_MARGIN))) {
            throw new BusinessException(ErrorCode.ANSWER_IN_PROGRESS);
        }
        // 여기부터 답변 스레드에 넘기기 전까지 실패하면(한도·스레드 부족·DB 오류) 진행 표시를 풀고 "들을게요" 표시를 되돌린다
        boolean offerTaken = false;
        try {
            ChatLog target = chatLog;
            if (!includeFuture) {
                // 확인과 표시 사이에 다른 구독이 답을 끝냈으면 다시 만들지 않는다
                target = chatLogRepository.findById(chatLogId).orElse(chatLog);
                if (target.isAnswered()) {
                    inProgress.finish(chatLogId);
                    return sendAnswered(sink, emitter, target);
                }
            } else if (!futureOffer.take(chatLogId)) {
                throw new BusinessException(ErrorCode.FUTURE_NOT_AVAILABLE);
            } else {
                offerTaken = true;
            }
            boolean llmAllowed = acquireLlm(target);
            long startedAt = System.nanoTime();
            ChatLog answering = target;
            try {
                executors.answer().execute(() -> answer(answering, sink, llmAllowed, startedAt, includeFuture));
            } catch (RejectedExecutionException e) {
                log.warn("[CHAT] 답변 스레드가 모두 사용 중 chatLogId={}", chatLogId);
                throw new BusinessException(ErrorCode.CHAT_AI_UNAVAILABLE);
            }
            return emitter;
        } catch (RuntimeException e) {
            inProgress.finish(chatLogId);
            restoreFutureOffer(chatLogId, offerTaken);
            throw e;
        }
    }

    private SseEmitter sendAnswered(AnswerSink sink, SseEmitter emitter, ChatLog chatLog) {
        sink.send("done", new Done(chatLog.getAnswerText(), chatLog.getAnswerSource(), chatLog.getFirstAudioMs(),
                chatLog.getTotalLatencyMs(), futureOffered(chatLog)));
        sink.complete();
        return emitter;
    }

    /** "들을게요" 답변을 시작하지 못했거나 끝내지 못했으면 다시 들을 수 있게 표시를 되돌린다(표시를 지운 경우만) */
    private void restoreFutureOffer(Long chatLogId, boolean taken) {
        if (taken) {
            futureOffer.offer(chatLogId);
        }
    }

    private boolean futureOffered(ChatLog chatLog) {
        return chatLog.getIntent() == ChatIntent.QUESTION && chatLog.getAnswerSource() == AnswerSource.UNANSWERABLE
                && futureOffer.exists(chatLog.getId());
    }

    SseEmitter newEmitter() {
        return new SseEmitter(properties.streamTimeout().toMillis());
    }

    /** QUESTION은 한도면 CHAT_009(진행 표시 해제는 subscribe가), SCENE_NOW는 한도여도 장면 설명으로 답한다 */
    private boolean acquireLlm(ChatLog chatLog) {
        try {
            rateLimiter.acquireLlm(chatLog.getUserId());
            return true;
        } catch (BusinessException e) {
            if (chatLog.getIntent() == ChatIntent.SCENE_NOW) {
                return false;
            }
            throw e;
        }
    }

    /**
     * 답변 스레드. 15초마다 SSE 주석(heartbeat)을 보낸다: "자료에 없어요"를 잡아 두고 뒤 내용을 확인하는 동안처럼
     * 한동안 보낼 글자가 없어도 FE(45초)·프록시가 연결을 끊지 않게
     */
    void answer(ChatLog chatLog, AnswerSink sink, boolean llmAllowed, long startedAt, boolean includeFuture) {
        ScheduledFuture<?> heartbeat = scheduleHeartbeat(sink);
        try {
            respond(chatLog, sink, llmAllowed, startedAt, includeFuture);
        } finally {
            if (heartbeat != null) {
                heartbeat.cancel(false);
            }
        }
    }

    private ScheduledFuture<?> scheduleHeartbeat(AnswerSink sink) {
        try {
            return executors.heartbeat().scheduleAtFixedRate(sink::heartbeat, HEARTBEAT_INTERVAL.toSeconds(),
                    HEARTBEAT_INTERVAL.toSeconds(), TimeUnit.SECONDS);
        } catch (RejectedExecutionException e) {
            // 서버 종료 중
            return null;
        }
    }

    /** 끝까지 만들었으면 answer_source까지, 실패·취소면 받은 글자와 시간만 남긴다 */
    private void respond(ChatLog chatLog, AnswerSink sink, boolean llmAllowed, long startedAt, boolean includeFuture) {
        boolean checkFuture = !includeFuture && chatLog.getIntent() == ChatIntent.QUESTION && tuning.answerFutureCheck();
        AnswerSession session = new AnswerSession(sink, this::speech, executors.tts(), startedAt, checkFuture);
        AnswerSource savedSource = null;
        boolean futureAvailable = false;
        String result;
        String lastEvent = null;
        Object lastData = null;
        try {
            int nowMs = chatLog.getVideoTimeMs() == null ? 0 : chatLog.getVideoTimeMs();
            boolean recap = chatLog.getIntent() == ChatIntent.RECAP;
            Optional<AnswerContext> context = chatLog.getDescriptionId() == null || recap ? Optional.empty()
                    : answerContextReader.read(chatLog.getDescriptionId(), nowMs, tuning.answerPastOnly(),
                    // 지금 장면 설명은 지금 화면의 글자가 핵심이라 끝나지 않은 장면의 화면 글자도 넣는다
                    tuning.answerPastOnly() && chatLog.getIntent() != ChatIntent.SCENE_NOW);
            AnswerSource source;
            if (recap && chatLog.getDescriptionId() != null) {
                source = recap(session, chatLog, nowMs);
            } else if (context.isEmpty()) {
                session.speak(List.of(NO_DESCRIPTION));
                source = AnswerSource.UNANSWERABLE;
            } else if (chatLog.getIntent() == ChatIntent.SCENE_NOW) {
                source = sceneNow(session, context.get(), llmAllowed, chatLog.getId());
            } else if (includeFuture) {
                source = futureAnswer(session, context.get(), chatLog, nowMs);
            } else {
                source = question(session, context.get(), chatLog.getUtterance(), chatLog.getId(), checkFuture);
                if (checkFuture && source == AnswerSource.UNANSWERABLE && !session.cancelled()) {
                    futureAvailable = hasTimeForFutureCheck(session, chatLog.getId()) && futureHasAnswer(chatLog, nowMs);
                    if (futureAvailable || session.text().isEmpty()) {
                        session.speak(List.of(futureAvailable ? AnswerPrompt.FUTURE_PROMPT : AnswerPrompt.UNANSWERABLE));
                    }
                    if (futureAvailable) {
                        futureOffer.offer(chatLog.getId());
                    }
                }
            }
            session.awaitSpeech(properties.speechWait());
            if (session.cancelled()) {
                result = "cancelled";
            } else {
                savedSource = source;
                result = source.name().toLowerCase();
            }
        } catch (LlmException e) {
            session.awaitSpeech(properties.speechWait());
            String code = streamErrorCode(e.getKind());
            result = session.cancelled() ? "cancelled" : code.toLowerCase();
            lastEvent = "error";
            lastData = new Failed(code, streamErrorMessage(code));
        } catch (RuntimeException e) {
            log.error("[CHAT] 답변 실패 chatLogId={}", chatLog.getId(), e);
            session.awaitSpeech(properties.speechWait());
            result = "unknown";
            lastEvent = "error";
            lastData = new Failed("UNKNOWN", streamErrorMessage("UNKNOWN"));
        }
        int totalMs = session.elapsedMs();
        if (savedSource != null) {
            lastEvent = "done";
            lastData = new Done(session.text(), savedSource, session.firstAudioMs(), totalMs, futureAvailable);
        }
        // 저장 → 진행 표시 해제 → done/error → 닫기 순서: done을 받고 바로 다시 구독(includeFuture 등)해도 저장된 답을 본다
        save(chatLog.getId(), session.text(), savedSource, session.firstAudioMs(), totalMs);
        if (savedSource == null) {
            restoreFutureOffer(chatLog.getId(), includeFuture);
        }
        inProgress.finish(chatLog.getId());
        if (lastEvent != null) {
            sink.send(lastEvent, lastData);
        }
        sink.complete();
        Timer.builder("audisay.chat.answer").tag("intent", chatLog.getIntent().name()).tag("result", result)
                .register(meterRegistry).record(totalMs, TimeUnit.MILLISECONDS);
        if (session.firstAudioMs() != null) {
            Timer.builder("audisay.chat.answer.first_audio").tag("intent", chatLog.getIntent().name())
                    .register(meterRegistry).record(session.firstAudioMs(), TimeUnit.MILLISECONDS);
        }
    }

    /** @param deferUnanswerable true면 "자료에 없어요"를 여기서 읽지 않는다(뒤 확인 뒤 서비스가 읽음) */
    private AnswerSource question(AnswerSession session, AnswerContext context, String question, Long chatLogId,
                                  boolean deferUnanswerable) {
        LlmRequest request = LlmRequest.text(LlmPurpose.ANSWER, AnswerPrompt.QUESTION_SYSTEM,
                answerPrompt.questionUser(context, question), AnswerPrompt.MAX_OUTPUT_TOKENS).withChatLogId(chatLogId);
        try {
            llmClient.stream(request, session::onDelta);
        } catch (LlmException e) {
            if (e.getKind() != LlmException.Kind.BLOCKED || session.generated()) {
                throw e;
            }
            if (!deferUnanswerable) {
                session.speak(List.of(AnswerPrompt.UNANSWERABLE));
            }
            return AnswerSource.UNANSWERABLE;
        }
        session.flush();
        if (session.suppressedUnanswerable()) {
            return AnswerSource.UNANSWERABLE;
        }
        if (!session.generated()) {
            if (!deferUnanswerable) {
                session.speak(List.of(AnswerPrompt.UNANSWERABLE));
            }
            return AnswerSource.UNANSWERABLE;
        }
        return AnswerPrompt.saidUnanswerable(session.text()) ? AnswerSource.UNANSWERABLE : AnswerSource.STORED;
    }

    /**
     * 뒤 내용 확인(최대 futureCheckTimeout) + 남은 음성 대기까지 SSE 연결 시간 안에 끝날 때만 확인한다.
     * 모자라면 확인하지 않고 "자료에 없어요"로 끝낸다(연결이 done 없이 끊기는 것보다 낫다)
     */
    private boolean hasTimeForFutureCheck(AnswerSession session, Long chatLogId) {
        long remainingMs = properties.streamTimeout().toMillis() - session.elapsedMs()
                - properties.speechWait().toMillis();
        if (remainingMs >= properties.futureCheckTimeout().toMillis()) {
            return true;
        }
        log.info("[CHAT] 남은 시간이 모자라 뒤 내용 확인을 건너뜁니다 chatLogId={} remainingMs={}", chatLogId, remainingMs);
        meterRegistry.counter("audisay.chat.answer.future", "result", "no_time").increment();
        return false;
    }

    /**
     * 뒤쪽 자료에 답이 있는지 LLM 1회(LLM 한도에 셈). 자료가 없거나 확인이 실패하면 없다고 본다.
     * 지표 audisay.chat.answer.future result: available / none / skipped(한도·장애)
     */
    private boolean futureHasAnswer(ChatLog chatLog, int nowMs) {
        Optional<FutureContext> future = answerContextReader.readFuture(chatLog.getDescriptionId(), nowMs);
        if (future.isEmpty() || (future.get().scenes().isEmpty() && future.get().dialogues().isEmpty())) {
            return false;
        }
        String result = "skipped";
        try {
            rateLimiter.acquireLlm(chatLog.getUserId());
            // 덤 확인이라 대체 모델까지 부르면 SSE 시간 예산(hasTimeForFutureCheck)을 넘을 수 있어 주 모델만
            LlmResult check = llmClient.generate(LlmRequest.json(LlmPurpose.ANSWER, AnswerPrompt.FUTURE_CHECK_SYSTEM,
                    answerPrompt.futureCheckUser(future.get(), chatLog.getUtterance()), AnswerPrompt.CHECK_MAX_OUTPUT_TOKENS)
                    .withChatLogId(chatLog.getId()).withoutFallback());
            String evidence = check == null ? null : answerPrompt.evidence(check.text());
            boolean available = evidence != null;
            result = available ? "available" : "none";
            log.info("[CHAT] 뒤 내용 확인 chatLogId={} available={} 근거={}", chatLog.getId(), available, evidence);
            return available;
        } catch (BusinessException | LlmException e) {
            log.warn("[CHAT] 뒤 내용 확인을 건너뜁니다 chatLogId={}: {}", chatLog.getId(), e.getMessage());
            return false;
        } finally {
            meterRegistry.counter("audisay.chat.answer.future", "result", result).increment();
        }
    }

    /** 지금까지 줄거리: 질문한 시각 전 목차(끝난 장면 요약 + 지금 장면 해설 문장)만으로 2~4문장 */
    private AnswerSource recap(AnswerSession session, ChatLog chatLog, int nowMs) {
        Optional<RecapContext> recap = recapReader.read(chatLog.getDescriptionId(), nowMs);
        if (recap.isEmpty()) {
            session.speak(List.of(NO_DESCRIPTION));
            return AnswerSource.UNANSWERABLE;
        }
        if (recap.get().parts().isEmpty()) {
            session.speak(List.of(AnswerPrompt.NO_RECAP));
            return AnswerSource.UNANSWERABLE;
        }
        LlmRequest request = LlmRequest.text(LlmPurpose.ANSWER, AnswerPrompt.RECAP_SYSTEM,
                answerPrompt.recapUser(recap.get()), AnswerPrompt.MAX_OUTPUT_TOKENS).withChatLogId(chatLog.getId());
        try {
            llmClient.stream(request, session::onDelta);
        } catch (LlmException e) {
            if (e.getKind() != LlmException.Kind.BLOCKED || session.generated()) {
                throw e;
            }
            session.speak(List.of(AnswerPrompt.UNANSWERABLE));
            return AnswerSource.UNANSWERABLE;
        }
        session.flush();
        if (!session.generated()) {
            session.speak(List.of(AnswerPrompt.NO_RECAP));
            return AnswerSource.UNANSWERABLE;
        }
        return AnswerSource.STORED;
    }

    /** "지금 이후 내용 들을게요": 질문한 시각까지 자료 + 뒤 자료로 답한다(FUTURE) */
    private AnswerSource futureAnswer(AnswerSession session, AnswerContext context, ChatLog chatLog, int nowMs) {
        Optional<FutureContext> future = answerContextReader.readFuture(chatLog.getDescriptionId(), nowMs);
        if (future.isEmpty()) {
            session.speak(List.of(AnswerPrompt.UNANSWERABLE));
            return AnswerSource.UNANSWERABLE;
        }
        LlmRequest request = LlmRequest.text(LlmPurpose.ANSWER, AnswerPrompt.FUTURE_SYSTEM,
                answerPrompt.futureUser(context, future.get(), chatLog.getUtterance()), AnswerPrompt.MAX_OUTPUT_TOKENS)
                .withChatLogId(chatLog.getId());
        try {
            llmClient.stream(request, session::onDelta);
        } catch (LlmException e) {
            if (e.getKind() != LlmException.Kind.BLOCKED || session.generated()) {
                throw e;
            }
            session.speak(List.of(AnswerPrompt.UNANSWERABLE));
            return AnswerSource.UNANSWERABLE;
        }
        session.flush();
        if (!session.generated()) {
            session.speak(List.of(AnswerPrompt.UNANSWERABLE));
            return AnswerSource.UNANSWERABLE;
        }
        return AnswerPrompt.saidUnanswerable(session.text()) ? AnswerSource.UNANSWERABLE : AnswerSource.FUTURE;
    }

    private AnswerSource sceneNow(AnswerSession session, AnswerContext context, boolean llmAllowed, Long chatLogId) {
        String title = tuning.answerPastOnly() ? null : SceneNowComposer.title(context);
        if (title != null) {
            session.speak(List.of(title));
        }
        if (llmAllowed) {
            LlmRequest request = LlmRequest.text(LlmPurpose.ANSWER,
                    tuning.answerPastOnly() ? AnswerPrompt.SCENE_NOW_PAST_SYSTEM : AnswerPrompt.SCENE_NOW_SYSTEM,
                    answerPrompt.sceneNowUser(context), AnswerPrompt.MAX_OUTPUT_TOKENS).withChatLogId(chatLogId);
            try {
                LlmResult result = llmClient.stream(request, session::onDelta);
                session.flush();
                if (result.cancelled() || session.generated()) {
                    return AnswerSource.STORED;
                }
            } catch (LlmException e) {
                log.warn("[CHAT] 지금 장면 LLM 실패 → 장면 설명으로 chatLogId={} kind={}", chatLogId, e.getKind());
                session.flush();
                if (session.generated()) {
                    return AnswerSource.STORED;
                }
            }
        }
        if (!session.cancelled()) {
            session.speak(SceneNowComposer.fallback(context));
        }
        return AnswerSource.STORED;
    }

    /**
     * 문장 → 음성 주소. AI 서버가 못 만들거나 꺼져 있으면 null(그 문장만 브라우저 음성).
     * 지표 audisay.chat.answer.tts result: made / cached / TTS_002(H200 꺼짐) / TTS_003(H200 실패) / error(AI 서버 호출 실패)
     */
    private String speech(String sentence) {
        String result;
        String audioUrl = null;
        try {
            TtsResult tts = aiServerClient.synthesize(sentence, properties.voice());
            audioUrl = tts.audioUrl();
            result = audioUrl != null ? (tts.cached() ? "cached" : "made") : String.valueOf(tts.reason());
        } catch (AiServerException e) {
            result = "error";
        }
        meterRegistry.counter("audisay.chat.answer.tts", "result", result).increment();
        return audioUrl;
    }

    private void save(Long chatLogId, String text, AnswerSource source, Integer firstAudioMs, int totalMs) {
        try {
            transactionTemplate.executeWithoutResult(status -> chatLogRepository.findById(chatLogId).ifPresent(chat ->
                    chat.answer(text.isEmpty() ? null : text, source, firstAudioMs, totalMs)));
        } catch (RuntimeException e) {
            log.error("[CHAT] 답변 저장 실패 chatLogId={}", chatLogId, e);
        }
    }

    static String streamErrorCode(LlmException.Kind kind) {
        return switch (kind) {
            case TIMEOUT -> "AI_TIMEOUT";
            case RATE_LIMIT -> "AI_LIMIT";
            case UNAVAILABLE -> "AI_UNAVAILABLE";
            default -> "UNKNOWN";
        };
    }

    static String streamErrorMessage(String code) {
        return switch (code) {
            case "AI_TIMEOUT" -> "답변이 늦어지고 있어요. 다시 질문해 주세요.";
            case "AI_LIMIT" -> "지금은 이용할 수 없어요. 나중에 다시 질문해 주세요.";
            case "AI_UNAVAILABLE" -> "지금은 답할 수 없어요. 잠시 후 다시 질문해 주세요.";
            default -> "알 수 없는 오류가 났어요. 다시 질문해 주세요.";
        };
    }
}
