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
import com.audisay.domain.chat.search.AnswerRetriever;
import com.audisay.domain.chat.search.SceneSearchProperties.Mode;
import com.audisay.domain.chat.search.VectorLine;
import com.audisay.domain.chat.tuning.ChatTuningProperties;
import com.audisay.domain.description.service.AnswerContext;
import com.audisay.domain.description.service.AnswerContext.Narration;
import com.audisay.domain.description.service.AnswerContext.SceneInfo;
import com.audisay.domain.description.service.AnswerContextReader;
import com.audisay.domain.description.service.FutureContext;
import com.audisay.domain.description.service.RecapContext;
import com.audisay.domain.description.service.RecapReader;
import com.audisay.domain.description.service.VideoAccessValidator;
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
import java.util.concurrent.atomic.AtomicInteger;
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
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ChatAnswerServiceTest {
    private static final AuthUser USER = new AuthUser(2L, Role.GENERAL, "sid");
    private static final long DESC = 9301L;

    private final AnswerContext context = new AnswerContext("두산 대 LG", "두산이 이겼어요.", 200_000,
            List.of(new SceneInfo(180_000, "2회 초", "투수가 공을 던집니다. 타자가 기다립니다. 관중이 외칩니다.", List.of(),
                    List.of())), List.of(), List.of());
    private final FutureContext future = new FutureContext("두산이 이겼어요.", List.of(new SceneInfo(300_000, "3회 초",
            "감독이 더그아웃에서 박수를 칩니다.", List.of(new Narration(310_000, "김태형 감독이 박수를 칩니다")), List.of())),
            List.of());

    private ChatLogRepository chatLogRepository;
    private AnswerContextReader contextReader;
    private LlmClient llmClient;
    private AiServerClient aiServerClient;
    private ChatRateLimiter rateLimiter;
    private AnswerInProgress inProgress;
    private FutureOffer futureOffer;
    private RecapReader recapReader;
    private VideoAccessValidator videoAccessValidator;
    private AnswerRetriever answerRetriever;
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
        futureOffer = mock(FutureOffer.class);
        recapReader = mock(RecapReader.class);
        videoAccessValidator = mock(VideoAccessValidator.class);
        answerRetriever = mock(AnswerRetriever.class);
        when(answerRetriever.mode()).thenReturn(Mode.OFF);
        meterRegistry = new SimpleMeterRegistry();
        emitter = new CapturingEmitter();
        when(inProgress.start(anyLong(), any())).thenReturn(true);
        when(contextReader.read(eq(DESC), eq(200_000), eq(true), org.mockito.ArgumentMatchers.anyBoolean()))
                .thenReturn(Optional.of(context));
        when(aiServerClient.synthesize(anyString(), eq("F1")))
                .thenAnswer(invocation -> new TtsResult("https://s3/" + invocation.getArgument(0), "key", 900, false, null));
        service = new ChatAnswerService(chatLogRepository, contextReader, new AnswerPrompt(JsonMapper.builder().build()),
                llmClient, aiServerClient, rateLimiter, inProgress,
                new ChatAnswerExecutors(Runnable::run, Runnable::run),
                new ChatAnswerProperties(null, null, null, null, Duration.ofSeconds(1), null),
                new TransactionTemplate(mock(PlatformTransactionManager.class)), meterRegistry,
                ChatTuningProperties.DEFAULT, futureOffer, recapReader, videoAccessValidator, answerRetriever) {
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
        assertThat(chat.isAnswered()).isFalse();
        verify(inProgress).finish(31L);
    }

    @Test
    void 실패한_답변은_다시_구독하면_새로_만든다() {
        ChatLog chat = chatLog(31L, ChatIntent.QUESTION, "질문");
        chat.answer("김광현이", null, null, 60_000);
        stream("김광현이 던졌어요.");

        service.subscribe(USER, 31L);

        assertThat(emitter.names()).endsWith("done");
        assertThat(chat.getAnswerSource()).isEqualTo(AnswerSource.STORED);
        assertThat(chat.getAnswerText()).isEqualTo("김광현이 던졌어요.");
        verify(llmClient).stream(any(), any());
    }

    @Test
    void 들을게요_답변이_실패하면_원래_답을_지키고_다시_들을_수_있게_한다() {
        ChatLog chat = chatLog(31L, ChatIntent.QUESTION, "감독 이름이 뭐야?");
        chat.answer(AnswerPrompt.FUTURE_PROMPT, AnswerSource.UNANSWERABLE, 500, 900);
        when(futureOffer.exists(31L)).thenReturn(true);
        when(futureOffer.take(31L)).thenReturn(true);
        when(contextReader.readFuture(DESC, 200_000)).thenReturn(Optional.of(future));
        when(llmClient.stream(any(), any())).thenThrow(new LlmException(LlmException.Kind.UNAVAILABLE, 503, "down", null));

        service.subscribe(USER, 31L, true);

        assertThat(emitter.names()).endsWith("error");
        assertThat(chat.getAnswerSource()).isEqualTo(AnswerSource.UNANSWERABLE);
        assertThat(chat.getAnswerText()).isEqualTo(AnswerPrompt.FUTURE_PROMPT);
        verify(futureOffer).offer(31L);
    }

    @Test
    void done은_저장하고_진행_표시를_푼_뒤에_보낸다() {
        ChatLog chat = chatLog(31L, ChatIntent.QUESTION, "질문");
        stream("김광현이 던졌어요.");
        List<AnswerSource> savedWhenFinished = new ArrayList<>();
        org.mockito.Mockito.doAnswer(invocation -> {
            savedWhenFinished.add(chat.getAnswerSource());
            assertThat(emitter.names()).doesNotContain("done");
            return null;
        }).when(inProgress).finish(31L);

        service.subscribe(USER, 31L);

        assertThat(savedWhenFinished).containsExactly(AnswerSource.STORED);
        assertThat(emitter.names()).endsWith("done");
    }

    @Test
    void SSE_시간이_모자라면_뒤_내용_확인을_건너뛴다() {
        ChatAnswerService tight = new ChatAnswerService(chatLogRepository, contextReader,
                new AnswerPrompt(JsonMapper.builder().build()), llmClient, aiServerClient, rateLimiter, inProgress,
                new ChatAnswerExecutors(Runnable::run, Runnable::run),
                new ChatAnswerProperties(null, null, null, Duration.ofSeconds(30), Duration.ofSeconds(1),
                        Duration.ofSeconds(60)),
                new TransactionTemplate(mock(PlatformTransactionManager.class)), meterRegistry,
                ChatTuningProperties.DEFAULT, futureOffer, recapReader, videoAccessValidator, answerRetriever) {
            @Override
            SseEmitter newEmitter() {
                return emitter;
            }
        };
        chatLog(31L, ChatIntent.QUESTION, "감독 이름이 뭐야?");
        stream("그건 해설 자료에 없어요.");
        when(contextReader.readFuture(DESC, 200_000)).thenReturn(Optional.of(future));

        tight.subscribe(USER, 31L);

        verify(llmClient, never()).generate(any());
        assertThat(emitter.data(Sentence.class)).extracting(Sentence::text).containsExactly(AnswerPrompt.UNANSWERABLE);
        assertThat(emitter.data(Done.class).get(0).futureAvailable()).isFalse();
    }

    @Test
    void 지금_장면은_제목_없이_LLM이_질문한_시각까지_자료로_설명한다() {
        ChatLog chat = chatLog(31L, ChatIntent.SCENE_NOW, "지금 뭐가 나와?");
        stream("투수가 공을 던지려고 해요.");

        service.subscribe(USER, 31L);

        assertThat(emitter.data(Sentence.class)).extracting(Sentence::text).containsExactly("투수가 공을 던지려고 해요.");
        assertThat(chat.getAnswerText()).isEqualTo("투수가 공을 던지려고 해요.");
        ArgumentCaptor<LlmRequest> captor = ArgumentCaptor.forClass(LlmRequest.class);
        verify(llmClient).stream(captor.capture(), any());
        assertThat(captor.getValue().system()).isEqualTo(AnswerPrompt.SCENE_NOW_PAST_SYSTEM);
    }

    @Test
    void 바로_하는_답을_끄면_지금_장면은_제목을_먼저_읽고_LLM이_잇는다() {
        ChatAnswerService old = new ChatAnswerService(chatLogRepository, contextReader,
                new AnswerPrompt(JsonMapper.builder().build()), llmClient, aiServerClient, rateLimiter, inProgress,
                new ChatAnswerExecutors(Runnable::run, Runnable::run),
                new ChatAnswerProperties(null, null, null, null, Duration.ofSeconds(1), null),
                new TransactionTemplate(mock(PlatformTransactionManager.class)), meterRegistry,
                new ChatTuningProperties(true, true, true, true, true, true, true, false, false), futureOffer,
                recapReader, videoAccessValidator, answerRetriever) {
            @Override
            SseEmitter newEmitter() {
                return emitter;
            }
        };
        ChatLog chat = chatLog(31L, ChatIntent.SCENE_NOW, "지금 뭐가 나와?");
        when(contextReader.read(DESC, 200_000, false, false)).thenReturn(Optional.of(context));
        stream("투수가 공을 던지려고 해요.");

        old.subscribe(USER, 31L);

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
                .containsExactly("투수가 공을 던집니다.", "타자가 기다립니다.");
        assertThat(chat.getAnswerSource()).isEqualTo(AnswerSource.STORED);
    }

    @Test
    void 지금_장면은_LLM_한도면_LLM_없이_장면_설명() {
        chatLog(31L, ChatIntent.SCENE_NOW, "지금 뭐가 나와?");
        doThrow(new BusinessException(ErrorCode.CHAT_RATE_LIMIT)).when(rateLimiter).acquireLlm(2L);

        service.subscribe(USER, 31L);

        verify(llmClient, never()).stream(any(), any());
        assertThat(emitter.data(Sentence.class)).hasSize(2);
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
        assertThat(emitter.data(Done.class)).containsExactly(new Done("김광현이에요.", AnswerSource.STORED, 800, 1500, false));
        verify(llmClient, never()).stream(any(), any());
        verify(inProgress, never()).start(anyLong(), any());
    }

    @Test
    void 해설이_없으면_답할_수_없다고_읽는다() {
        chatLog(31L, ChatIntent.QUESTION, "질문");
        when(contextReader.read(eq(DESC), eq(200_000), eq(true), org.mockito.ArgumentMatchers.anyBoolean()))
                .thenReturn(Optional.empty());

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
                new ChatAnswerProperties(null, null, null, null, null, null),
                new TransactionTemplate(mock(PlatformTransactionManager.class)), meterRegistry,
                ChatTuningProperties.DEFAULT, futureOffer, recapReader, videoAccessValidator, answerRetriever);

        assertError(31L, ErrorCode.CHAT_AI_UNAVAILABLE);
        verify(inProgress).finish(31L);
    }

    @Test
    void 바로_답하지_못하고_뒤에_답이_있으면_자료에_없다는_말_대신_들을지_묻는다() {
        ChatLog chat = chatLog(31L, ChatIntent.QUESTION, "감독 이름이 뭐야?");
        stream("그건 해설 자료에 없어요.");
        when(contextReader.readFuture(DESC, 200_000)).thenReturn(Optional.of(future));
        when(llmClient.generate(any())).thenReturn(
                new LlmResult("{\"evidence\": \"김태형 감독이 박수를 칩니다\"}", "gemini-3.1-flash-lite", 500, 12, 400, false, 2L));

        service.subscribe(USER, 31L);

        assertThat(emitter.data(Sentence.class)).extracting(Sentence::text).containsExactly(AnswerPrompt.FUTURE_PROMPT);
        Done done = emitter.data(Done.class).get(0);
        assertThat(done.answerSource()).isEqualTo(AnswerSource.UNANSWERABLE);
        assertThat(done.futureAvailable()).isTrue();
        assertThat(chat.getAnswerText()).isEqualTo(AnswerPrompt.FUTURE_PROMPT);
        verify(futureOffer).offer(31L);
        verify(rateLimiter, times(2)).acquireLlm(2L);
        ArgumentCaptor<LlmRequest> captor = ArgumentCaptor.forClass(LlmRequest.class);
        verify(llmClient).generate(captor.capture());
        assertThat(captor.getValue().system()).isEqualTo(AnswerPrompt.FUTURE_CHECK_SYSTEM);
        assertThat(captor.getValue().user()).contains("김태형 감독이 박수를 칩니다").endsWith("질문: 감독 이름이 뭐야?");
        assertThat(meterRegistry.get("audisay.chat.answer.future").tag("result", "available").counter().count()).isEqualTo(1);
    }

    @Test
    void ALWAYS면_지금_자료보다_앞에서_찾은_비슷한_줄을_처음부터_함께_넣어_답한다() {
        ChatLog chat = chatLog(31L, ChatIntent.QUESTION, "클템의 역할이 뭐야?");
        when(answerRetriever.mode()).thenReturn(Mode.ALWAYS);
        float[] vector = {0.1f, 0.2f};
        when(answerRetriever.embed(DESC, "클템의 역할이 뭐야?", 31L)).thenReturn(vector);
        when(answerRetriever.before(DESC, vector, 180_000)).thenReturn(
                List.of(new VectorLine("DIALOGUE", 7L, 20_000, "오늘 해설을 맡은 클템입니다", 0.8)));
        stream("해설을 맡았어요.");

        service.subscribe(USER, 31L);

        assertThat(chat.getAnswerSource()).isEqualTo(AnswerSource.STORED);
        ArgumentCaptor<LlmRequest> captor = ArgumentCaptor.forClass(LlmRequest.class);
        verify(llmClient).stream(captor.capture(), any());
        assertThat(captor.getValue().system()).isEqualTo(AnswerPrompt.QUESTION_EARLIER_SYSTEM);
        assertThat(captor.getValue().user()).contains("앞에서 나온 관련 내용", "오늘 해설을 맡은 클템입니다", "대사")
                .endsWith("질문: 클템의 역할이 뭐야?");
        assertThat(meterRegistry.get("audisay.chat.answer.rag").tag("result", "always").counter().count()).isEqualTo(1);
    }

    @Test
    void FALLBACK은_지금_자료로_답하지_못하면_앞_줄을_더해_다시_묻는다() {
        ChatLog chat = chatLog(31L, ChatIntent.QUESTION, "클템의 역할이 뭐야?");
        when(answerRetriever.mode()).thenReturn(Mode.FALLBACK);
        float[] vector = {0.1f, 0.2f};
        when(answerRetriever.embed(DESC, "클템의 역할이 뭐야?", 31L)).thenReturn(vector);
        when(answerRetriever.before(DESC, vector, 180_000)).thenReturn(
                List.of(new VectorLine("DIALOGUE", 7L, 20_000, "오늘 해설을 맡은 클템입니다", 0.8)));
        streamInTurn("그건 해설 자료에 없어요.", "해설을 맡았어요.");

        service.subscribe(USER, 31L);

        assertThat(emitter.data(Sentence.class)).extracting(Sentence::text).containsExactly("해설을 맡았어요.");
        assertThat(chat.getAnswerText()).isEqualTo("해설을 맡았어요.");
        assertThat(chat.getAnswerSource()).isEqualTo(AnswerSource.STORED);
        ArgumentCaptor<LlmRequest> captor = ArgumentCaptor.forClass(LlmRequest.class);
        verify(llmClient, times(2)).stream(captor.capture(), any());
        assertThat(captor.getAllValues()).extracting(LlmRequest::system)
                .containsExactly(AnswerPrompt.QUESTION_SYSTEM, AnswerPrompt.QUESTION_EARLIER_SYSTEM);
        assertThat(captor.getAllValues().get(1).user()).contains("오늘 해설을 맡은 클템입니다");
        verify(rateLimiter, times(2)).acquireLlm(2L);
        verify(llmClient, never()).generate(any());
        assertThat(meterRegistry.get("audisay.chat.answer.rag").tag("result", "earlier").counter().count()).isEqualTo(1);
    }

    @Test
    void FALLBACK에서_다시_물어도_답하지_못하면_함께_돌린_뒤_확인으로_들을지_묻는다() {
        ChatLog chat = chatLog(31L, ChatIntent.QUESTION, "감독 이름이 뭐야?");
        when(answerRetriever.mode()).thenReturn(Mode.FALLBACK);
        float[] vector = {0.1f, 0.2f};
        when(answerRetriever.embed(DESC, "감독 이름이 뭐야?", 31L)).thenReturn(vector);
        when(answerRetriever.before(DESC, vector, 180_000)).thenReturn(
                List.of(new VectorLine("NARRATION", 3L, 20_000, "투수가 몸을 풉니다", 0.4)));
        when(answerRetriever.after(DESC, vector, 200_000)).thenReturn(
                List.of(new VectorLine("NARRATION", 9L, 310_000, "김태형 감독이 박수를 칩니다", 0.7)));
        streamInTurn("그건 해설 자료에 없어요.", "그건 해설 자료에 없어요.");
        when(llmClient.generate(any())).thenReturn(
                new LlmResult("{\"evidence\": \"김태형 감독\"}", "gemini-3.1-flash-lite", 500, 12, 400, false, 2L));

        service.subscribe(USER, 31L);

        assertThat(emitter.data(Sentence.class)).extracting(Sentence::text).containsExactly(AnswerPrompt.FUTURE_PROMPT);
        assertThat(emitter.data(Done.class).get(0).futureAvailable()).isTrue();
        assertThat(chat.getAnswerSource()).isEqualTo(AnswerSource.UNANSWERABLE);
        verify(llmClient, times(2)).stream(any(), any());
        verify(llmClient, times(1)).generate(any());
        verify(futureOffer).offer(31L);
    }

    @Test
    void FALLBACK은_지금_자료로_답하면_앞_줄을_찾지_않는다() {
        ChatLog chat = chatLog(31L, ChatIntent.QUESTION, "누가 던졌어?");
        when(answerRetriever.mode()).thenReturn(Mode.FALLBACK);
        stream("김광현이 던졌어요.");

        service.subscribe(USER, 31L);

        assertThat(chat.getAnswerSource()).isEqualTo(AnswerSource.STORED);
        verify(answerRetriever, never()).before(anyLong(), any(), org.mockito.ArgumentMatchers.anyInt());
        verify(llmClient, times(1)).stream(any(), any());
        assertThat(meterRegistry.get("audisay.chat.answer.rag").tag("result", "answered").counter().count()).isEqualTo(1);
    }

    @Test
    void FALLBACK에서_뒤_확인을_꺼도_다시_묻지_못하면_자료에_없다고_읽는다() {
        ChatLog chat = chatLog(31L, ChatIntent.QUESTION, "감독 이름이 뭐야?");
        when(answerRetriever.mode()).thenReturn(Mode.FALLBACK);
        service = new ChatAnswerService(chatLogRepository, contextReader, new AnswerPrompt(JsonMapper.builder().build()),
                llmClient, aiServerClient, rateLimiter, inProgress,
                new ChatAnswerExecutors(Runnable::run, Runnable::run),
                new ChatAnswerProperties(null, null, null, null, Duration.ofSeconds(1), null),
                new TransactionTemplate(mock(PlatformTransactionManager.class)), meterRegistry,
                new ChatTuningProperties(null, null, null, null, null, null, null, true, false), futureOffer, recapReader, videoAccessValidator, answerRetriever) {
            @Override
            SseEmitter newEmitter() {
                return emitter;
            }
        };
        stream("그건 해설 자료에 없어요.");

        service.subscribe(USER, 31L);

        assertThat(emitter.data(Sentence.class)).extracting(Sentence::text).containsExactly(AnswerPrompt.UNANSWERABLE);
        assertThat(chat.getAnswerSource()).isEqualTo(AnswerSource.UNANSWERABLE);
    }

    @Test
    void 질문_벡터가_있으면_뒤_확인은_비슷한_뒤_줄로_한다() {
        chatLog(31L, ChatIntent.QUESTION, "감독 이름이 뭐야?");
        when(answerRetriever.mode()).thenReturn(Mode.FALLBACK);
        float[] vector = {0.1f, 0.2f};
        when(answerRetriever.embed(DESC, "감독 이름이 뭐야?", 31L)).thenReturn(vector);
        when(answerRetriever.after(DESC, vector, 200_000)).thenReturn(
                List.of(new VectorLine("NARRATION", 9L, 310_000, "김태형 감독이 박수를 칩니다", 0.7)));
        when(answerRetriever.summary(DESC)).thenReturn("두산이 이겼어요.");
        stream("그건 해설 자료에 없어요.");
        when(llmClient.generate(any())).thenReturn(
                new LlmResult("{\"evidence\": \"김태형 감독\"}", "gemini-3.1-flash-lite", 500, 12, 400, false, 2L));

        service.subscribe(USER, 31L);

        assertThat(emitter.data(Done.class).get(0).futureAvailable()).isTrue();
        verify(contextReader, never()).readFuture(anyLong(), org.mockito.ArgumentMatchers.anyInt());
        ArgumentCaptor<LlmRequest> stream = ArgumentCaptor.forClass(LlmRequest.class);
        verify(llmClient).stream(stream.capture(), any());
        assertThat(stream.getValue().system()).isEqualTo(AnswerPrompt.QUESTION_SYSTEM);
        ArgumentCaptor<LlmRequest> check = ArgumentCaptor.forClass(LlmRequest.class);
        verify(llmClient).generate(check.capture());
        assertThat(check.getValue().system()).isEqualTo(AnswerPrompt.FUTURE_CHECK_LINES_SYSTEM);
        assertThat(check.getValue().user()).contains("김태형 감독이 박수를 칩니다", "두산이 이겼어요.")
                .endsWith("질문: 감독 이름이 뭐야?");
        assertThat(meterRegistry.get("audisay.chat.answer.rag").tag("result", "none").counter().count()).isEqualTo(1);
    }

    @Test
    void 뒤에_비슷한_줄이_없으면_확인_없이_자료에_없다고_읽는다() {
        chatLog(31L, ChatIntent.QUESTION, "감독 이름이 뭐야?");
        when(answerRetriever.mode()).thenReturn(Mode.FALLBACK);
        when(answerRetriever.embed(DESC, "감독 이름이 뭐야?", 31L)).thenReturn(new float[]{0.1f});
        stream("그건 해설 자료에 없어요.");

        service.subscribe(USER, 31L);

        assertThat(emitter.data(Sentence.class)).extracting(Sentence::text).containsExactly(AnswerPrompt.UNANSWERABLE);
        verify(llmClient, never()).generate(any());
        verify(rateLimiter, times(1)).acquireLlm(2L);
    }

    @Test
    void 뒤에도_답이_없으면_자료에_없다고_읽는다() {
        chatLog(31L, ChatIntent.QUESTION, "감독 이름이 뭐야?");
        stream("그건 해설 자료에 없어요.");
        when(contextReader.readFuture(DESC, 200_000)).thenReturn(Optional.of(future));
        when(llmClient.generate(any())).thenReturn(
                new LlmResult("{\"evidence\": \"\"}", "gemini-3.1-flash-lite", 500, 5, 400, false, 2L));

        service.subscribe(USER, 31L);

        assertThat(emitter.data(Sentence.class)).extracting(Sentence::text).containsExactly(AnswerPrompt.UNANSWERABLE);
        assertThat(emitter.data(Done.class).get(0).futureAvailable()).isFalse();
        verify(futureOffer, never()).offer(anyLong());
    }

    @Test
    void 뒤_확인을_끄면_자료에_없다는_답을_그대로_읽는다() {
        ChatAnswerService plain = new ChatAnswerService(chatLogRepository, contextReader,
                new AnswerPrompt(JsonMapper.builder().build()), llmClient, aiServerClient, rateLimiter, inProgress,
                new ChatAnswerExecutors(Runnable::run, Runnable::run),
                new ChatAnswerProperties(null, null, null, null, Duration.ofSeconds(1), null),
                new TransactionTemplate(mock(PlatformTransactionManager.class)), meterRegistry,
                new ChatTuningProperties(true, true, true, true, true, true, true, false, false), futureOffer,
                recapReader, videoAccessValidator, answerRetriever) {
            @Override
            SseEmitter newEmitter() {
                return emitter;
            }
        };
        chatLog(31L, ChatIntent.QUESTION, "감독 이름이 뭐야?");
        when(contextReader.read(DESC, 200_000, false, false)).thenReturn(Optional.of(context));
        stream("그건 해설 자료에 없어요.");

        plain.subscribe(USER, 31L);

        assertThat(emitter.data(Sentence.class)).extracting(Sentence::text).containsExactly("그건 해설 자료에 없어요.");
        verify(llmClient, never()).generate(any());
        verify(contextReader, never()).readFuture(anyLong(), org.mockito.ArgumentMatchers.anyInt());
    }

    @Test
    void 지금_이후_내용을_듣기로_하면_뒤_자료까지_넣어_답하고_FUTURE로_남긴다() {
        ChatLog chat = chatLog(31L, ChatIntent.QUESTION, "감독 이름이 뭐야?");
        chat.answer(AnswerPrompt.FUTURE_PROMPT, AnswerSource.UNANSWERABLE, 500, 900);
        when(futureOffer.exists(31L)).thenReturn(true);
        when(futureOffer.take(31L)).thenReturn(true);
        when(contextReader.readFuture(DESC, 200_000)).thenReturn(Optional.of(future));
        stream("감독은 김태형이에요.");

        service.subscribe(USER, 31L, true);

        Done done = emitter.data(Done.class).get(0);
        assertThat(done.answerSource()).isEqualTo(AnswerSource.FUTURE);
        assertThat(done.futureAvailable()).isFalse();
        assertThat(chat.getAnswerSource()).isEqualTo(AnswerSource.FUTURE);
        assertThat(chat.getAnswerText()).isEqualTo("감독은 김태형이에요.");
        ArgumentCaptor<LlmRequest> captor = ArgumentCaptor.forClass(LlmRequest.class);
        verify(llmClient).stream(captor.capture(), any());
        assertThat(captor.getValue().system()).isEqualTo(AnswerPrompt.FUTURE_SYSTEM);
        assertThat(captor.getValue().user()).contains("뒤 내용:").contains("김태형 감독이 박수를 칩니다");
    }

    @Test
    void 들으시겠어요를_묻지_않은_답변이면_CHAT_010() {
        ChatLog chat = chatLog(31L, ChatIntent.QUESTION, "질문");
        chat.answer("김광현이에요.", AnswerSource.STORED, 800, 1500);

        assertThatThrownBy(() -> service.subscribe(USER, 31L, true))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode").isEqualTo(ErrorCode.FUTURE_NOT_AVAILABLE);
        verify(llmClient, never()).stream(any(), any());
    }

    @Test
    void 끝난_답변을_다시_구독하면_들을_수_있는지도_알려준다() {
        ChatLog chat = chatLog(31L, ChatIntent.QUESTION, "감독 이름이 뭐야?");
        chat.answer(AnswerPrompt.FUTURE_PROMPT, AnswerSource.UNANSWERABLE, 500, 900);
        when(futureOffer.exists(31L)).thenReturn(true);

        service.subscribe(USER, 31L);

        assertThat(emitter.data(Done.class).get(0).futureAvailable()).isTrue();
        verify(futureOffer, never()).take(anyLong());
    }

    @Test
    void 지금까지_줄거리는_질문한_시각_전_목차로_정리한다() {
        ChatLog chat = chatLog(31L, ChatIntent.RECAP, "지금까지 줄거리 알려 줘");
        when(recapReader.read(DESC, 200_000)).thenReturn(Optional.of(new RecapContext("두산 대 LG", 200_000, List.of(
                new RecapContext.Part(0, "1회 초", "두산이 선취점을 냅니다."),
                new RecapContext.Part(180_000, "2회 초", "투수가 공을 던집니다.")))));
        stream("두산이 1회에 먼저 점수를 냈어요. 지금은 2회 초예요.");

        service.subscribe(USER, 31L);

        assertThat(emitter.data(Done.class).get(0).answerSource()).isEqualTo(AnswerSource.STORED);
        assertThat(chat.getAnswerText()).isEqualTo("두산이 1회에 먼저 점수를 냈어요. 지금은 2회 초예요.");
        ArgumentCaptor<LlmRequest> captor = ArgumentCaptor.forClass(LlmRequest.class);
        verify(llmClient).stream(captor.capture(), any());
        assertThat(captor.getValue().system()).isEqualTo(AnswerPrompt.RECAP_SYSTEM);
        assertThat(captor.getValue().user()).contains("두산이 선취점을 냅니다.").endsWith("요청: 지금까지 줄거리를 2문장 이내로 정리해 주세요.");
        assertThat(captor.getValue().maxOutputTokens()).isEqualTo(AnswerPrompt.RECAP_MAX_OUTPUT_TOKENS);
        verify(contextReader, never()).read(anyLong(), org.mockito.ArgumentMatchers.anyInt(),
                org.mockito.ArgumentMatchers.anyBoolean(), org.mockito.ArgumentMatchers.anyBoolean());
    }

    @Test
    void 지난_내용이_없으면_LLM_없이_안내() {
        chatLog(31L, ChatIntent.RECAP, "지금까지 줄거리 알려 줘");
        when(recapReader.read(DESC, 200_000)).thenReturn(Optional.of(new RecapContext("두산 대 LG", 200_000, List.of())));

        service.subscribe(USER, 31L);

        assertThat(emitter.data(Sentence.class)).extracting(Sentence::text).containsExactly(AnswerPrompt.NO_RECAP);
        verify(llmClient, never()).stream(any(), any());
    }

    @Test
    void 영상이_비공개로_바뀌었으면_답변을_받지_못한다() {
        chatLog(31L, ChatIntent.QUESTION, "질문");
        when(videoAccessValidator.getAccessibleVideo(USER, 9301L))
                .thenThrow(new BusinessException(ErrorCode.VIDEO_PRIVATE));

        assertError(31L, ErrorCode.VIDEO_PRIVATE);
        verify(inProgress, never()).start(anyLong(), any());
    }

    @Test
    void 진행_표시_뒤_DB_오류가_나도_표시를_푼다() {
        ChatLog chat = chatLog(31L, ChatIntent.QUESTION, "질문");
        when(chatLogRepository.findById(31L)).thenReturn(Optional.of(chat))
                .thenThrow(new org.springframework.dao.QueryTimeoutException("db"));

        assertThatThrownBy(() -> service.subscribe(USER, 31L))
                .isInstanceOf(org.springframework.dao.QueryTimeoutException.class);
        verify(inProgress).finish(31L);
    }

    @Test
    void 뒤_내용_확인은_대체_모델을_부르지_않는다() {
        chatLog(31L, ChatIntent.QUESTION, "감독 이름이 뭐야?");
        stream("그건 해설 자료에 없어요.");
        when(contextReader.readFuture(DESC, 200_000)).thenReturn(Optional.of(future));
        when(llmClient.generate(any())).thenReturn(
                new LlmResult("{\"evidence\": \"\"}", "gemini-3.1-flash-lite", 500, 5, 400, false, 2L));

        service.subscribe(USER, 31L);

        ArgumentCaptor<LlmRequest> captor = ArgumentCaptor.forClass(LlmRequest.class);
        verify(llmClient).generate(captor.capture());
        assertThat(captor.getValue().noFallback()).isTrue();
    }

    @Test
    void 공백만_온_답은_답으로_치지_않는다() {
        ChatLog chat = chatLog(31L, ChatIntent.SCENE_NOW, "지금 뭐가 나와?");
        stream("\n", " ");

        service.subscribe(USER, 31L);

        assertThat(emitter.data(Sentence.class)).extracting(Sentence::text)
                .containsExactly("투수가 공을 던집니다.", "타자가 기다립니다.");
        assertThat(chat.getAnswerText()).isEqualTo("투수가 공을 던집니다. 타자가 기다립니다.");
    }

    @Test
    void heartbeat는_이벤트가_아닌_주석이고_닫힌_뒤에는_보내지_않는다() {
        AnswerSink sink = new AnswerSink(emitter);

        sink.heartbeat();
        sink.complete();
        sink.heartbeat();

        assertThat(emitter.heartbeats).isEqualTo(1);
        assertThat(emitter.names()).isEmpty();
    }

    @Test
    void 지금_장면_설명은_끝나지_않은_장면의_화면_글자도_받고_질문은_뺀다() {
        chatLog(31L, ChatIntent.SCENE_NOW, "지금 뭐가 나와?");
        chatLog(32L, ChatIntent.QUESTION, "누가 던졌어?");
        stream("투수가 공을 던지려고 해요.");

        service.subscribe(USER, 31L);
        service.subscribe(USER, 32L);

        verify(contextReader).read(DESC, 200_000, true, false);
        verify(contextReader).read(DESC, 200_000, true, true);
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

    /** 부를 때마다 다음 답(마지막 답은 반복) */
    private void streamInTurn(String... answers) {
        AtomicInteger call = new AtomicInteger();
        when(llmClient.stream(any(), any())).thenAnswer(invocation -> {
            String answer = answers[Math.min(call.getAndIncrement(), answers.length - 1)];
            DeltaHandler handler = invocation.getArgument(1);
            handler.onDelta(answer);
            return new LlmResult(answer, "gemini-3.1-flash-lite", 100, 20, 800, false, 1L);
        });
    }

    /** 보낸 이벤트를 모은다. failAfter번째 다음부터는 연결이 끊긴 것처럼 IOException */
    static class CapturingEmitter extends SseEmitter {
        private static final Pattern NAME = Pattern.compile("event:(\\w+)");
        private final List<String> names = new ArrayList<>();
        private final List<Object> data = new ArrayList<>();
        int failAfter = Integer.MAX_VALUE;
        int heartbeats;
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
                    if (text.startsWith(":")) {
                        heartbeats++;
                    }
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
