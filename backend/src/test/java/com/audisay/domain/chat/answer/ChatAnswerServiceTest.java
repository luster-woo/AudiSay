package com.audisay.domain.chat.answer;

import com.audisay.domain.chat.dto.response.AnswerStreamEvent.Delta;
import com.audisay.domain.chat.dto.response.AnswerStreamEvent.Done;
import com.audisay.domain.chat.dto.response.AnswerStreamEvent.Failed;
import com.audisay.domain.chat.dto.response.AnswerStreamEvent.Sentence;
import com.audisay.domain.chat.entity.AnswerSource;
import com.audisay.domain.chat.entity.ChatIntent;
import com.audisay.domain.chat.entity.ChatLog;
import com.audisay.domain.chat.entity.InputMode;
import com.audisay.domain.chat.ratelimit.ChatRateLimiter;
import com.audisay.domain.chat.repository.ChatLogRepository;
import com.audisay.domain.description.service.AnswerContext;
import com.audisay.domain.description.service.AnswerContext.SceneInfo;
import com.audisay.domain.description.service.AnswerContextReader;
import com.audisay.domain.user.entity.Role;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import com.audisay.global.external.ai.AiServerClient;
import com.audisay.global.external.ai.AiServerException;
import com.audisay.global.external.ai.TtsResult;
import com.audisay.global.external.llm.DeltaHandler;
import com.audisay.global.external.llm.LlmClient;
import com.audisay.global.external.llm.LlmException;
import com.audisay.global.external.llm.LlmPurpose;
import com.audisay.global.external.llm.LlmRequest;
import com.audisay.global.external.llm.LlmResult;
import com.audisay.global.security.AuthUser;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.MediaType;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyEmitter;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ChatAnswerServiceTest {
    private static final AuthUser USER = new AuthUser(2L, Role.GENERAL, "sid");
    private static final long DESC = 9301L;

    private final AnswerContext context = new AnswerContext("두산 대 LG", "두산이 이겼어요.", 200_000,
            List.of(new SceneInfo(180_000, "2회 초", "투수가 공을 던집니다. 타자가 기다립니다. 관중이 외칩니다.", List.of(),
                    List.of())), List.of(), List.of());

    private ChatLogRepository chatLogRepository;
    private AnswerContextReader contextReader;
    private LlmClient llmClient;
    private AiServerClient aiServerClient;
    private ChatRateLimiter rateLimiter;
    private AnswerInProgress inProgress;
    private SimpleMeterRegistry meterRegistry;
    private CapturingEmitter emitter;
    private ChatAnswerService service;

    @BeforeEach
    void setUp() {
        chatLogRepository = mock(ChatLogRepository.class);
        contextReader = mock(AnswerContextReader.class);
        llmClient = mock(LlmClient.class);
        aiServerClient = mock(AiServerClient.class);
        rateLimiter = mock(ChatRateLimiter.class);
        inProgress = mock(AnswerInProgress.class);
        meterRegistry = new SimpleMeterRegistry();
        emitter = new CapturingEmitter();
        when(inProgress.start(anyLong(), any())).thenReturn(true);
        when(contextReader.read(DESC, 200_000)).thenReturn(Optional.of(context));
        when(aiServerClient.synthesize(anyString(), eq("F1")))
                .thenAnswer(invocation -> new TtsResult("https://s3/" + invocation.getArgument(0), "key", 900, false, null));
        service = new ChatAnswerService(chatLogRepository, contextReader, new AnswerPrompt(JsonMapper.builder().build()),
                llmClient, aiServerClient, rateLimiter, inProgress,
                new ChatAnswerExecutors(Runnable::run, Runnable::run),
                new ChatAnswerProperties(null, null, null, null, Duration.ofSeconds(1)),
                new TransactionTemplate(mock(PlatformTransactionManager.class)), meterRegistry) {
            @Override
            SseEmitter newEmitter() {
                return emitter;
            }
        };
    }

    @Test
    void 질문은_글자_조각을_바로_보내고_문장마다_음성을_붙여_보낸_뒤_done() {
        ChatLog chat = chatLog(31L, ChatIntent.QUESTION, "누가 던졌어?");
        stream("김광현이 ", "던졌어요. 왼손", "이에요.");

        service.subscribe(USER, 31L);

        assertThat(emitter.names()).containsExactly("delta", "delta", "sentence", "delta", "sentence", "done");
        assertThat(emitter.data(Sentence.class)).containsExactly(
                new Sentence("김광현이 던졌어요.", "https://s3/김광현이 던졌어요."), new Sentence("왼손이에요.", "https://s3/왼손이에요."));
        Done done = emitter.data(Done.class).get(0);
        assertThat(done.answerText()).isEqualTo("김광현이 던졌어요. 왼손이에요.");
        assertThat(done.answerSource()).isEqualTo(AnswerSource.STORED);
        assertThat(done.firstAudioMs()).isNotNull();
        assertThat(emitter.completed).isTrue();
        assertThat(chat.getAnswerText()).isEqualTo("김광현이 던졌어요. 왼손이에요.");
        assertThat(chat.getAnswerSource()).isEqualTo(AnswerSource.STORED);
        assertThat(chat.isAnswered()).isTrue();
        verify(inProgress).finish(31L);
        verify(rateLimiter).acquireLlm(2L);

        ArgumentCaptor<LlmRequest> captor = ArgumentCaptor.forClass(LlmRequest.class);
        verify(llmClient).stream(captor.capture(), any());
        assertThat(captor.getValue().purpose()).isEqualTo(LlmPurpose.ANSWER);
        assertThat(captor.getValue().system()).isEqualTo(AnswerPrompt.QUESTION_SYSTEM);
        assertThat(captor.getValue().chatLogId()).isEqualTo(31L);
        assertThat(captor.getValue().user()).endsWith("질문: 누가 던졌어?");
        assertThat(meterRegistry.get("audisay.chat.answer").tag("result", "stored").timer().count()).isEqualTo(1);
    }

    @Test
    void 자료에_없다고_답하면_UNANSWERABLE() {
        ChatLog chat = chatLog(31L, ChatIntent.QUESTION, "감독 이름이 뭐야?");
        stream("그건 해설 자료에 없어요.");

        service.subscribe(USER, 31L);

        assertThat(emitter.data(Done.class).get(0).answerSource()).isEqualTo(AnswerSource.UNANSWERABLE);
        assertThat(chat.getAnswerSource()).isEqualTo(AnswerSource.UNANSWERABLE);
    }

    @Test
    void 안전_정책_거부도_자료에_없다는_답으로() {
        chatLog(31L, ChatIntent.QUESTION, "질문");
        when(llmClient.stream(any(), any())).thenThrow(new LlmException(LlmException.Kind.BLOCKED, 200, "blocked", null));

        service.subscribe(USER, 31L);

        assertThat(emitter.data(Sentence.class)).extracting(Sentence::text).containsExactly(AnswerPrompt.UNANSWERABLE);
        assertThat(emitter.data(Done.class).get(0).answerSource()).isEqualTo(AnswerSource.UNANSWERABLE);
    }

    @Test
    void LLM_시간_초과면_보낸_데까지_두고_error_이벤트() {
        ChatLog chat = chatLog(31L, ChatIntent.QUESTION, "질문");
        when(llmClient.stream(any(), any())).thenAnswer(invocation -> {
            DeltaHandler handler = invocation.getArgument(1);
            handler.onDelta("김광현이 던졌어요. ");
            throw new LlmException(LlmException.Kind.TIMEOUT, 0, "timeout", null);
        });

        service.subscribe(USER, 31L);

        assertThat(emitter.names()).containsExactly("delta", "sentence", "error");
        assertThat(emitter.data(Failed.class)).containsExactly(
                new Failed("AI_TIMEOUT", "답변이 늦어지고 있어요. 다시 질문해 주세요."));
        assertThat(chat.getAnswerText()).isEqualTo("김광현이 던졌어요.");
        assertThat(chat.getAnswerSource()).isNull();
        assertThat(chat.isAnswered()).isTrue();
        verify(inProgress).finish(31L);
    }

    @Test
    void 지금_장면은_제목을_먼저_읽고_LLM이_잇는다() {
        ChatLog chat = chatLog(31L, ChatIntent.SCENE_NOW, "지금 뭐가 나와?");
        stream("투수가 공을 던지려고 해요.");

        service.subscribe(USER, 31L);

        assertThat(emitter.data(Sentence.class)).extracting(Sentence::text)
                .containsExactly("지금은 2회 초 장면이에요.", "투수가 공을 던지려고 해요.");
        assertThat(emitter.data(Delta.class)).extracting(Delta::text)
                .containsExactly("지금은 2회 초 장면이에요.", " ", "투수가 공을 던지려고 해요.");
        assertThat(chat.getAnswerText()).isEqualTo("지금은 2회 초 장면이에요. 투수가 공을 던지려고 해요.");
        ArgumentCaptor<LlmRequest> captor = ArgumentCaptor.forClass(LlmRequest.class);
        verify(llmClient).stream(captor.capture(), any());
        assertThat(captor.getValue().system()).isEqualTo(AnswerPrompt.SCENE_NOW_SYSTEM);
    }

    @Test
    void 지금_장면은_LLM이_실패하면_에러_대신_장면_설명() {
        ChatLog chat = chatLog(31L, ChatIntent.SCENE_NOW, "지금 뭐가 나와?");
        when(llmClient.stream(any(), any())).thenThrow(new LlmException(LlmException.Kind.UNAVAILABLE, 503, "down", null));

        service.subscribe(USER, 31L);

        assertThat(emitter.names()).doesNotContain("error").endsWith("done");
        assertThat(emitter.data(Sentence.class)).extracting(Sentence::text)
                .containsExactly("지금은 2회 초 장면이에요.", "투수가 공을 던집니다.", "타자가 기다립니다.");
        assertThat(chat.getAnswerSource()).isEqualTo(AnswerSource.STORED);
    }

    @Test
    void 지금_장면은_LLM_한도면_LLM_없이_장면_설명() {
        chatLog(31L, ChatIntent.SCENE_NOW, "지금 뭐가 나와?");
        doThrow(new BusinessException(ErrorCode.CHAT_RATE_LIMIT)).when(rateLimiter).acquireLlm(2L);

        service.subscribe(USER, 31L);

        verify(llmClient, never()).stream(any(), any());
        assertThat(emitter.data(Sentence.class)).hasSize(3);
    }

    @Test
    void 질문은_LLM_한도면_CHAT_009이고_진행_표시를_푼다() {
        chatLog(31L, ChatIntent.QUESTION, "질문");
        doThrow(new BusinessException(ErrorCode.CHAT_RATE_LIMIT)).when(rateLimiter).acquireLlm(2L);

        assertThatThrownBy(() -> service.subscribe(USER, 31L))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode").isEqualTo(ErrorCode.CHAT_RATE_LIMIT);
        verify(inProgress).finish(31L);
    }

    @Test
    void 음성을_못_만들면_그_문장만_audioUrl_null() {
        chatLog(31L, ChatIntent.QUESTION, "질문");
        stream("하나예요. 둘이에요.");
        when(aiServerClient.synthesize(eq("하나예요."), anyString()))
                .thenThrow(new AiServerException(AiServerException.Kind.TIMEOUT, 0, null, "timeout", null));

        service.subscribe(USER, 31L);

        assertThat(emitter.data(Sentence.class)).containsExactly(new Sentence("하나예요.", null),
                new Sentence("둘이에요.", "https://s3/둘이에요."));
        assertThat(meterRegistry.get("audisay.chat.answer.tts").tag("result", "error").counter().count()).isEqualTo(1);
        assertThat(meterRegistry.get("audisay.chat.answer.tts").tag("result", "made").counter().count()).isEqualTo(1);
    }

    @Test
    void 연결이_끊기면_LLM을_멈추고_done을_보내지_않는다() {
        ChatLog chat = chatLog(31L, ChatIntent.QUESTION, "질문");
        emitter.failAfter = 1;
        List<Boolean> continued = new ArrayList<>();
        when(llmClient.stream(any(), any())).thenAnswer(invocation -> {
            DeltaHandler handler = invocation.getArgument(1);
            continued.add(handler.onDelta("김광현이 "));
            continued.add(handler.onDelta("던졌어요. "));
            return new LlmResult("김광현이 ", "gemini-3.1-flash-lite", 100, 5, 300, true, null);
        });

        service.subscribe(USER, 31L);

        assertThat(continued).containsExactly(true, false);
        assertThat(emitter.names()).containsExactly("delta");
        assertThat(chat.getAnswerSource()).isNull();
        assertThat(meterRegistry.get("audisay.chat.answer").tag("result", "cancelled").timer().count()).isEqualTo(1);
    }

    @Test
    void 이미_끝난_답변은_done만_보내고_LLM을_부르지_않는다() {
        ChatLog chat = chatLog(31L, ChatIntent.QUESTION, "질문");
        chat.answer("김광현이에요.", AnswerSource.STORED, 800, 1500);

        service.subscribe(USER, 31L);

        assertThat(emitter.names()).containsExactly("done");
        assertThat(emitter.data(Done.class)).containsExactly(new Done("김광현이에요.", AnswerSource.STORED, 800, 1500));
        verify(llmClient, never()).stream(any(), any());
        verify(inProgress, never()).start(anyLong(), any());
    }

    @Test
    void 해설이_없으면_답할_수_없다고_읽는다() {
        chatLog(31L, ChatIntent.QUESTION, "질문");
        when(contextReader.read(DESC, 200_000)).thenReturn(Optional.empty());

        service.subscribe(USER, 31L);

        assertThat(emitter.data(Sentence.class)).extracting(Sentence::text).containsExactly(ChatAnswerService.NO_DESCRIPTION);
        assertThat(emitter.data(Done.class).get(0).answerSource()).isEqualTo(AnswerSource.UNANSWERABLE);
    }

    @Test
    void 남의_기록_답변이_아닌_입력_없는_기록_이미_만드는_중이면_JSON_에러() {
        assertError(31L, ErrorCode.CHAT_LOG_NOT_FOUND);

        ChatLog other = ChatLog.receive(9L, 9301L, DESC, 200_000, InputMode.TEXT, "질문");
        other.classify(ChatIntent.QUESTION, 10);
        ReflectionTestUtils.setField(other, "id", 32L);
        when(chatLogRepository.findById(32L)).thenReturn(Optional.of(other));
        assertError(32L, ErrorCode.FORBIDDEN);

        chatLog(33L, ChatIntent.SEEK_SCENE, "홈런 장면");
        assertError(33L, ErrorCode.NOT_ANSWERABLE_INPUT);

        chatLog(34L, ChatIntent.QUESTION, "질문");
        when(inProgress.start(eq(34L), any())).thenReturn(false);
        assertError(34L, ErrorCode.ANSWER_IN_PROGRESS);
    }

    @Test
    void 답변_스레드가_모두_차면_CHAT_005() {
        chatLog(31L, ChatIntent.QUESTION, "질문");
        service = new ChatAnswerService(chatLogRepository, contextReader, new AnswerPrompt(JsonMapper.builder().build()),
                llmClient, aiServerClient, rateLimiter, inProgress,
                new ChatAnswerExecutors(runnable -> {
                    throw new java.util.concurrent.RejectedExecutionException("full");
                }, Runnable::run),
                new ChatAnswerProperties(null, null, null, null, null),
                new TransactionTemplate(mock(PlatformTransactionManager.class)), meterRegistry);

        assertError(31L, ErrorCode.CHAT_AI_UNAVAILABLE);
        verify(inProgress).finish(31L);
    }

    private void assertError(Long chatLogId, ErrorCode errorCode) {
        assertThatThrownBy(() -> service.subscribe(USER, chatLogId))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode").isEqualTo(errorCode);
    }

    private ChatLog chatLog(Long id, ChatIntent intent, String utterance) {
        ChatLog chat = ChatLog.receive(2L, 9301L, DESC, 200_000, InputMode.TEXT, utterance);
        chat.classify(intent, 10);
        ReflectionTestUtils.setField(chat, "id", id);
        when(chatLogRepository.findById(id)).thenReturn(Optional.of(chat));
        return chat;
    }

    private void stream(String... deltas) {
        when(llmClient.stream(any(), any())).thenAnswer(invocation -> {
            DeltaHandler handler = invocation.getArgument(1);
            for (String delta : deltas) {
                handler.onDelta(delta);
            }
            return new LlmResult(String.join("", deltas), "gemini-3.1-flash-lite", 100, 20, 800, false, 1L);
        });
    }

    /** 보낸 이벤트를 모은다. failAfter번째 다음부터는 연결이 끊긴 것처럼 IOException */
    static class CapturingEmitter extends SseEmitter {
        private static final Pattern NAME = Pattern.compile("event:(\\w+)");
        private final List<String> names = new ArrayList<>();
        private final List<Object> data = new ArrayList<>();
        int failAfter = Integer.MAX_VALUE;
        boolean completed;

        @Override
        public synchronized void send(SseEventBuilder builder) throws IOException {
            if (names.size() >= failAfter) {
                throw new IOException("Broken pipe");
            }
            Set<ResponseBodyEmitter.DataWithMediaType> parts = builder.build();
            for (ResponseBodyEmitter.DataWithMediaType part : parts) {
                Object value = part.getData();
                if (value instanceof String text) {
                    Matcher matcher = NAME.matcher(text);
                    if (matcher.find()) {
                        names.add(matcher.group(1));
                    }
                } else if (!MediaType.TEXT_PLAIN.equals(part.getMediaType())) {
                    data.add(value);
                }
            }
        }

        @Override
        public synchronized void complete() {
            completed = true;
        }

        List<String> names() {
            return names;
        }

        <T> List<T> data(Class<T> type) {
            return data.stream().filter(type::isInstance).map(type::cast).toList();
        }
    }
}
