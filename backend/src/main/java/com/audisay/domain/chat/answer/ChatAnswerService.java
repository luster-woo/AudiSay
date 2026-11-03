package com.audisay.domain.chat.answer;

import com.audisay.domain.chat.dto.response.AnswerStreamEvent.Done;
import com.audisay.domain.chat.dto.response.AnswerStreamEvent.Failed;
import com.audisay.domain.chat.entity.AnswerSource;
import com.audisay.domain.chat.entity.ChatIntent;
import com.audisay.domain.chat.entity.ChatLog;
import com.audisay.domain.chat.ratelimit.ChatRateLimiter;
import com.audisay.domain.chat.repository.ChatLogRepository;
import com.audisay.domain.description.service.AnswerContext;
import com.audisay.domain.description.service.AnswerContextReader;
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

import java.util.List;
import java.util.Optional;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;

/**
 * 질문 답변 SSE(GET /chat/messages/{chatLogId}/stream). 저장 자료만 근거로 LLM(gemini-3.1-flash-lite) 스트리밍 →
 * 글자 조각은 delta, 문장이 끝나면 AI /internal/tts(Supertonic) 음성과 함께 sentence, 끝나면 done(실패면 error).
 * SCENE_NOW는 장면 제목을 먼저 읽고 LLM이 지금 화면을 잇는다(LLM을 못 쓰면 장면 설명으로).
 * 연결이 끊기면 LLM 스트림·남은 음성을 멈추고, 어느 경우든 받은 데까지 chat_logs에 남긴다
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ChatAnswerService {
    static final String NO_DESCRIPTION = "아직 해설이 없어서 답할 수 없어요.";

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

    /**
     * 권한·상태를 먼저 확인하고(실패는 JSON 에러), 답변은 답변 스레드에서 만든다. 이미 끝난 답변이면 done만 보내고 닫는다
     */
    public SseEmitter subscribe(AuthUser authUser, Long chatLogId) {
        ChatLog chatLog = chatLogRepository.findById(chatLogId)
                .orElseThrow(() -> new BusinessException(ErrorCode.CHAT_LOG_NOT_FOUND));
        if (!chatLog.getUserId().equals(authUser.userId())) {
            throw new BusinessException(ErrorCode.FORBIDDEN, "본인의 질문만 볼 수 있습니다.");
        }
        if (!chatLog.isAnswerable()) {
            throw new BusinessException(ErrorCode.NOT_ANSWERABLE_INPUT);
        }
        SseEmitter emitter = newEmitter();
        AnswerSink sink = new AnswerSink(emitter);
        if (chatLog.isAnswered()) {
            sink.send("done", new Done(chatLog.getAnswerText(), chatLog.getAnswerSource(), chatLog.getFirstAudioMs(),
                    chatLog.getTotalLatencyMs()));
            sink.complete();
            return emitter;
        }
        if (!inProgress.start(chatLogId, properties.streamTimeout().plusSeconds(30))) {
            throw new BusinessException(ErrorCode.ANSWER_IN_PROGRESS);
        }
        boolean llmAllowed = acquireLlm(chatLog);
        long startedAt = System.nanoTime();
        try {
            executors.answer().execute(() -> answer(chatLog, sink, llmAllowed, startedAt));
        } catch (RejectedExecutionException e) {
            inProgress.finish(chatLogId);
            log.warn("[CHAT] 답변 스레드가 모두 사용 중 chatLogId={}", chatLogId);
            throw new BusinessException(ErrorCode.CHAT_AI_UNAVAILABLE);
        }
        return emitter;
    }

    SseEmitter newEmitter() {
        return new SseEmitter(properties.streamTimeout().toMillis());
    }

    /** QUESTION은 한도면 CHAT_009, SCENE_NOW는 한도여도 장면 설명으로 답한다 */
    private boolean acquireLlm(ChatLog chatLog) {
        try {
            rateLimiter.acquireLlm(chatLog.getUserId());
            return true;
        } catch (BusinessException e) {
            if (chatLog.getIntent() == ChatIntent.SCENE_NOW) {
                return false;
            }
            inProgress.finish(chatLog.getId());
            throw e;
        }
    }

    /** 끝까지 만들었으면 answer_source까지, 실패·취소면 받은 글자와 시간만 남긴다 */
    void answer(ChatLog chatLog, AnswerSink sink, boolean llmAllowed, long startedAt) {
        AnswerSession session = new AnswerSession(sink, this::speech, executors.tts(), startedAt);
        AnswerSource savedSource = null;
        String result;
        try {
            Optional<AnswerContext> context = chatLog.getDescriptionId() == null ? Optional.empty()
                    : answerContextReader.read(chatLog.getDescriptionId(),
                    chatLog.getVideoTimeMs() == null ? 0 : chatLog.getVideoTimeMs());
            AnswerSource source;
            if (context.isEmpty()) {
                session.speak(List.of(NO_DESCRIPTION));
                source = AnswerSource.UNANSWERABLE;
            } else if (chatLog.getIntent() == ChatIntent.SCENE_NOW) {
                source = sceneNow(session, context.get(), llmAllowed, chatLog.getId());
            } else {
                source = question(session, context.get(), chatLog.getUtterance(), chatLog.getId());
            }
            session.awaitSpeech(properties.speechWait());
            if (session.cancelled()) {
                result = "cancelled";
            } else {
                savedSource = source;
                result = source.name().toLowerCase();
                sink.send("done", new Done(session.text(), source, session.firstAudioMs(), session.elapsedMs()));
            }
        } catch (LlmException e) {
            session.awaitSpeech(properties.speechWait());
            String code = streamErrorCode(e.getKind());
            result = session.cancelled() ? "cancelled" : code.toLowerCase();
            sink.send("error", new Failed(code, streamErrorMessage(code)));
        } catch (RuntimeException e) {
            log.error("[CHAT] 답변 실패 chatLogId={}", chatLog.getId(), e);
            session.awaitSpeech(properties.speechWait());
            result = "unknown";
            sink.send("error", new Failed("UNKNOWN", streamErrorMessage("UNKNOWN")));
        }
        // 저장 → 진행 표시 해제 → 닫기 순서: 닫은 직후 다시 구독해도 저장된 done을 받게
        int totalMs = session.elapsedMs();
        save(chatLog.getId(), session.text(), savedSource, session.firstAudioMs(), totalMs);
        inProgress.finish(chatLog.getId());
        sink.complete();
        Timer.builder("audisay.chat.answer").tag("intent", chatLog.getIntent().name()).tag("result", result)
                .register(meterRegistry).record(totalMs, TimeUnit.MILLISECONDS);
        if (session.firstAudioMs() != null) {
            Timer.builder("audisay.chat.answer.first_audio").tag("intent", chatLog.getIntent().name())
                    .register(meterRegistry).record(session.firstAudioMs(), TimeUnit.MILLISECONDS);
        }
    }

    private AnswerSource question(AnswerSession session, AnswerContext context, String question, Long chatLogId) {
        LlmRequest request = LlmRequest.text(LlmPurpose.ANSWER, AnswerPrompt.QUESTION_SYSTEM,
                answerPrompt.questionUser(context, question), AnswerPrompt.MAX_OUTPUT_TOKENS).withChatLogId(chatLogId);
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
        return AnswerPrompt.saidUnanswerable(session.text()) ? AnswerSource.UNANSWERABLE : AnswerSource.STORED;
    }

    private AnswerSource sceneNow(AnswerSession session, AnswerContext context, boolean llmAllowed, Long chatLogId) {
        String title = SceneNowComposer.title(context);
        if (title != null) {
            session.speak(List.of(title));
        }
        if (llmAllowed) {
            LlmRequest request = LlmRequest.text(LlmPurpose.ANSWER, AnswerPrompt.SCENE_NOW_SYSTEM,
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
