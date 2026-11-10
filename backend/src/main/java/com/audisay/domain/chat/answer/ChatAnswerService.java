package com.audisay.domain.chat.answer;

import com.audisay.domain.chat.dto.response.AnswerStreamEvent.Done;
import com.audisay.domain.chat.dto.response.AnswerStreamEvent.Failed;
import com.audisay.domain.chat.entity.AnswerSource;
import com.audisay.domain.chat.entity.ChatIntent;
import com.audisay.domain.chat.entity.ChatLog;
import com.audisay.domain.chat.ratelimit.ChatRateLimiter;
import com.audisay.domain.chat.repository.ChatLogRepository;
import com.audisay.domain.chat.search.AnswerRetriever;
import com.audisay.domain.chat.search.SceneSearchProperties.Mode;
import com.audisay.domain.chat.search.ChapterTitle;
import com.audisay.domain.chat.search.VectorLine;
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
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import java.util.regex.Pattern;

/**
 * 질문 답변 SSE(GET /chat/messages/{chatLogId}/stream). 저장 자료만 근거로 LLM(gemini-3.1-flash-lite) 스트리밍 →
 * 글자 조각은 delta, 문장이 끝나면 AI /internal/tts(Supertonic) 음성과 함께 sentence, 끝나면 done(실패면 error).
 * SCENE_NOW는 장면 제목을 먼저 읽고 LLM이 지금 화면을 잇는다(LLM을 못 쓰면 장면 설명으로).
 * 연결이 끊기면 LLM 스트림·남은 음성을 멈추고, 어느 경우든 받은 데까지 chat_logs에 남긴다.
 * 바로 하는 답은 질문한 시각까지 자료만(answer-past-only). 지금 자료로 답하지 못하면 질문과 비슷한 앞 줄을 더해 다시 답한다(질문 답변 RAG, FALLBACK). 답하지 못하면 뒤쪽 자료에 답이 있는지 LLM이 확인해(answer-future-check)
 * "지금 이후에 나와요, 들으시겠어요?"를 읽고 done.futureAvailable=true → includeFuture=true 재구독이면 뒤 자료까지 넣어 답한다(FUTURE)
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ChatAnswerService {
    static final String NO_DESCRIPTION = "아직 해설이 없어서 답할 수 없어요.";
    private static final Duration IN_PROGRESS_MARGIN = Duration.ofMinutes(3);
    private static final Duration HEARTBEAT_INTERVAL = Duration.ofSeconds(15);
    /**
     * 수를 묻는 질문("실책이 몇 번 나왔어?", "골 몇 개야?"). 바로 하는 답 자료(앞 장면·지금 장면)만으로 세면 그보다 앞에 나온 것을 빠뜨려
     * 틀린 수를 말하므로, FALLBACK이어도 앞에서 찾은 비슷한 줄을 처음부터 함께 넣는다
     */
    static final Pattern COUNTING = Pattern.compile(
            "몇\\s*(?:번|개|골|점|명|회|차례|가지|군데|곳|이닝|마리|잔|병|그릇|판|세트|경기)");

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
    private final AnswerRetriever answerRetriever;

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
            throw new BusinessException(ErrorCode.FORBIDDEN, "본인의 질문만 볼 수 있어요.");
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
        Mode ragMode = includeFuture || chatLog.getIntent() != ChatIntent.QUESTION ? Mode.OFF : answerRetriever.mode();
        // 지금 장면도 첫 문장을 잡아 둔다: LLM이 "자료에 없어요"로 시작하면 보내지 않고 장면 설명(대체)을 읽는다
        AnswerSession session = new AnswerSession(sink, this::speech, executors.tts(), startedAt,
                checkFuture || ragMode == Mode.FALLBACK || chatLog.getIntent() == ChatIntent.SCENE_NOW);
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
                Rag rag = new Rag(ragMode, chatLog);
                source = questionWithRag(session, context.get(), chatLog, checkFuture, nowMs, rag);
                if (checkFuture && source == AnswerSource.UNANSWERABLE && !session.cancelled()) {
                    futureAvailable = rag.futureCheck != null ? rag.futureAvailable()
                            : hasTimeForFutureCheck(session, chatLog.getId())
                            && futureHasAnswer(session, chatLog, nowMs, rag.vector());
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

    /**
     * 질문 답변 RAG. ALWAYS는 앞 줄을 처음부터 더하고, FALLBACK은 지금 자료로 먼저 답해 "자료에 없어요"(보낸 글자 없음)일 때만
     * 앞 줄을 더해 다시 묻는다. 임베딩은 첫 답과 동시에, 뒤 확인은 다시 묻기와 동시에 돌린다(다시 묻기로 답하면 버림).
     * 지표 audisay.chat.answer.rag result: off / answered(FALLBACK 첫 답으로 끝) / none(앞 줄 없음) / earlier(앞 줄로 다시) / always
     */
    private AnswerSource questionWithRag(AnswerSession session, AnswerContext context, ChatLog chatLog,
                                         boolean checkFuture, int nowMs, Rag rag) {
        String result = "off";
        AnswerSource source;
        boolean counting = rag.mode == Mode.FALLBACK && COUNTING.matcher(chatLog.getUtterance()).find();
        if (rag.mode == Mode.ALWAYS || counting) {
            List<VectorLine> earlier = answerRetriever.before(chatLog.getDescriptionId(), rag.vector(), windowStart(context));
            result = earlier.isEmpty() ? "none" : counting ? "count" : "always";
            source = question(session, context, earlier, pastTitles(chatLog, earlier, nowMs), chatLog.getUtterance(),
                    chatLog.getId(), checkFuture);
        } else if (rag.mode == Mode.FALLBACK) {
            source = question(session, context, List.of(), List.of(), chatLog.getUtterance(), chatLog.getId(), true);
            result = "answered";
            if (source == AnswerSource.UNANSWERABLE && session.text().isEmpty() && !session.cancelled()) {
                List<VectorLine> earlier = answerRetriever.before(chatLog.getDescriptionId(), rag.vector(),
                        windowStart(context));
                result = earlier.isEmpty() ? "none" : "earlier";
                if (!earlier.isEmpty() && retryAllowed(chatLog)) {
                    if (checkFuture) {
                        rag.startFutureCheck(() -> hasTimeForFutureCheck(session, chatLog.getId())
                                && futureHasAnswer(session, chatLog, nowMs, rag.vector()));
                    }
                    session.retry();
                    source = question(session, context, earlier, pastTitles(chatLog, earlier, nowMs),
                            chatLog.getUtterance(), chatLog.getId(), true);
                }
            }
            if (source == AnswerSource.UNANSWERABLE && !checkFuture && session.text().isEmpty() && !session.cancelled()) {
                session.speak(List.of(AnswerPrompt.UNANSWERABLE));
            }
        } else {
            source = question(session, context, List.of(), List.of(), chatLog.getUtterance(), chatLog.getId(), checkFuture);
        }
        meterRegistry.counter("audisay.chat.answer.rag", "result", result).increment();
        return source;
    }

    /** 앞 줄을 넣을 때만 질문 시각까지 끝난 장면 제목을 함께(앞 줄의 회차·순서를 맞추게) */
    private List<ChapterTitle> pastTitles(ChatLog chatLog, List<VectorLine> earlier, int nowMs) {
        return earlier.isEmpty() ? List.of() : answerRetriever.pastTitles(chatLog.getDescriptionId(), nowMs);
    }

    /** 다시 묻기도 LLM 한도에 센다. 한도면 다시 묻지 않고 "자료에 없어요"(뒤 확인)로 */
    private boolean retryAllowed(ChatLog chatLog) {
        try {
            rateLimiter.acquireLlm(chatLog.getUserId());
            return true;
        } catch (BusinessException e) {
            meterRegistry.counter("audisay.chat.answer.rag", "result", "limited").increment();
            return false;
        }
    }

    /** 질문 임베딩. OFF가 아니면 바로 시작하고 처음 쓸 때 기다린다(실패면 null → 예전 방식) */
    private final class Rag {
        private final Mode mode;
        private final CompletableFuture<float[]> vector;
        private CompletableFuture<Boolean> futureCheck;

        private Rag(Mode mode, ChatLog chatLog) {
            this.mode = mode;
            this.vector = mode == Mode.OFF ? CompletableFuture.completedFuture(null) : start(chatLog);
        }

        private CompletableFuture<float[]> start(ChatLog chatLog) {
            try {
                return CompletableFuture.supplyAsync(() -> answerRetriever.embed(chatLog.getDescriptionId(),
                        chatLog.getUtterance(), chatLog.getId()), executors.embed());
            } catch (RejectedExecutionException e) {
                return CompletableFuture.completedFuture(null);
            }
        }

        void startFutureCheck(BooleanSupplier check) {
            try {
                futureCheck = CompletableFuture.supplyAsync(check::getAsBoolean, executors.embed());
            } catch (RejectedExecutionException e) {
                futureCheck = null;
            }
        }

        boolean futureAvailable() {
            try {
                return futureCheck.join();
            } catch (RuntimeException e) {
                log.warn("[CHAT] 뒤 내용 확인을 쓰지 못함: {}", e.getMessage());
                return false;
            }
        }

        float[] vector() {
            try {
                return vector.join();
            } catch (RuntimeException e) {
                log.warn("[CHAT] 질문 임베딩을 쓰지 못함: {}", e.getMessage());
                return null;
            }
        }
    }

    /** 해설 자료(앞 장면 + 지금 장면)가 시작하는 시각. 이보다 앞 줄은 RAG로 찾는다 */
    private static int windowStart(AnswerContext context) {
        return context.scenes().isEmpty() ? context.nowMs() : context.scenes().get(0).startMs();
    }

    /** @param deferUnanswerable true면 "자료에 없어요"를 여기서 읽지 않는다(뒤 확인 뒤 서비스가 읽음) */
    private AnswerSource question(AnswerSession session, AnswerContext context, List<VectorLine> earlier,
                                  List<ChapterTitle> titles, String question, Long chatLogId, boolean deferUnanswerable) {
        LlmRequest request = LlmRequest.text(LlmPurpose.ANSWER,
                earlier.isEmpty() ? AnswerPrompt.QUESTION_SYSTEM : AnswerPrompt.QUESTION_EARLIER_SYSTEM,
                answerPrompt.questionUser(context, earlier, titles, question), AnswerPrompt.MAX_OUTPUT_TOKENS)
                .withChatLogId(chatLogId);
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
        long remainingMs = remainingMs(session);
        if (remainingMs >= properties.futureCheckTimeout().toMillis()) {
            return true;
        }
        log.info("[CHAT] 남은 시간이 모자라 뒤 내용 확인을 건너뜁니다 chatLogId={} remainingMs={}", chatLogId, remainingMs);
        meterRegistry.counter("audisay.chat.answer.future", "result", "no_time").increment();
        return false;
    }

    /** SSE가 끝나기 전에 LLM에 쓸 수 있는 남은 시간(남은 문장 음성을 기다릴 시간은 뺌) */
    private long remainingMs(AnswerSession session) {
        return properties.streamTimeout().toMillis() - session.elapsedMs() - properties.speechWait().toMillis();
    }

    /**
     * 뒤쪽 자료에 답이 있는지 LLM 1회(LLM 한도에 셈). 자료가 없거나 확인이 실패하면 없다고 본다.
     * 질문 벡터가 있으면 뒤 전체 대신 질문과 비슷한 뒤 줄 + 영상 요약으로 본다.
     * 주 모델이 한도(GMS 429)·장애면 SSE 남은 시간 안에 다 기다릴 수 있을 때만 대체 모델로(연달아 물으면 주 모델 한도에 걸려
     * "들으시겠어요?"가 빠지던 것)
     * 지표 audisay.chat.answer.future result: available / none / skipped(한도·장애)
     */
    private boolean futureHasAnswer(AnswerSession session, ChatLog chatLog, int nowMs, float[] vector) {
        String system;
        String user;
        if (vector != null) {
            List<VectorLine> later = answerRetriever.after(chatLog.getDescriptionId(), vector, nowMs);
            if (later.isEmpty()) {
                return false;
            }
            system = AnswerPrompt.FUTURE_CHECK_LINES_SYSTEM;
            user = answerPrompt.futureCheckLinesUser(answerRetriever.summary(chatLog.getDescriptionId()), later,
                    chatLog.getUtterance());
        } else {
            Optional<FutureContext> future = answerContextReader.readFuture(chatLog.getDescriptionId(), nowMs);
            if (future.isEmpty() || (future.get().scenes().isEmpty() && future.get().dialogues().isEmpty())) {
                return false;
            }
            system = AnswerPrompt.FUTURE_CHECK_SYSTEM;
            user = answerPrompt.futureCheckUser(future.get(), chatLog.getUtterance());
        }
        String result = "skipped";
        try {
            rateLimiter.acquireLlm(chatLog.getUserId());
            long deadlineNanos = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(remainingMs(session));
            LlmResult check = llmClient.generate(LlmRequest.json(LlmPurpose.ANSWER, system, user,
                    AnswerPrompt.CHECK_MAX_OUTPUT_TOKENS).withChatLogId(chatLog.getId()).withFallbackDeadline(deadlineNanos));
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

    /** 지금까지 줄거리: 질문한 시각 전 목차(끝난 장면 요약 + 지금 장면 해설 문장)만으로 장면 수에 따라 2~5문장 */
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
                answerPrompt.recapUser(recap.get()), AnswerPrompt.RECAP_MAX_OUTPUT_TOKENS).withChatLogId(chatLog.getId());
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
                if (result.cancelled()) {
                    return AnswerSource.STORED;
                }
                // 첫 문장이 "자료에 없어요"였으면(보내지 않았다) 아래 장면 설명으로 대신한다
                if (session.generated() && !session.suppressedUnanswerable()) {
                    return AnswerPrompt.saidUnanswerable(session.text()) ? AnswerSource.UNANSWERABLE : AnswerSource.STORED;
                }
                if (session.suppressedUnanswerable()) {
                    log.info("[CHAT] 지금 장면 LLM이 자료에 없다고 답함 → 장면 설명으로 chatLogId={}", chatLogId);
                }
            } catch (LlmException e) {
                log.warn("[CHAT] 지금 장면 LLM 실패 → 장면 설명으로 chatLogId={} kind={}", chatLogId, e.getKind());
                session.flush();
                if (session.generated() && !session.suppressedUnanswerable()) {
                    return AnswerSource.STORED;
                }
            }
        }
        if (!session.cancelled()) {
            List<String> fallback = SceneNowComposer.fallback(context);
            session.speak(fallback);
            // 장면 설명도 없으면 답하지 못한 것으로 남긴다 (관리자 통계의 바로 답한 비율이 부풀지 않게)
            if (fallback.equals(List.of(SceneNowComposer.NO_SCENE))) {
                return AnswerSource.UNANSWERABLE;
            }
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
