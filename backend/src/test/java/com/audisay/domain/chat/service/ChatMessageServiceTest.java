package com.audisay.domain.chat.service;

import com.audisay.domain.chat.dto.request.ChatMessageRequest;
import com.audisay.domain.chat.dto.response.ChatMessageResponse;
import com.audisay.domain.chat.entity.ChatIntent;
import com.audisay.domain.chat.entity.ChatLog;
import com.audisay.domain.chat.entity.InputMode;
import com.audisay.domain.chat.intent.ActionCode;
import com.audisay.domain.chat.intent.ClassifiedIntent;
import com.audisay.domain.chat.intent.LlmIntentClassifier;
import com.audisay.domain.chat.intent.RuleIntentClassifier;
import com.audisay.domain.chat.intent.SettingStepResolver;
import com.audisay.domain.chat.repository.ChatLogRepository;
import com.audisay.domain.description.service.DescriptionService;
import com.audisay.domain.description.service.VideoAccessValidator;
import com.audisay.domain.user.entity.Role;
import com.audisay.domain.video.entity.Video;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import com.audisay.global.security.AuthUser;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ChatMessageServiceTest {
    private static final AuthUser USER = new AuthUser(2L, Role.GENERAL, "sid");
    private static final long CHAT_LOG_ID = 31L;
    private static final long VIDEO_ID = 9101L;

    private ChatLogRepository chatLogRepository;
    private LlmIntentClassifier llmClassifier;
    private SettingStepResolver settingStepResolver;
    private VideoAccessValidator videoAccessValidator;
    private DescriptionService descriptionService;
    private SimpleMeterRegistry meterRegistry;
    private ChatMessageService service;
    private ChatLog saved;

    @BeforeEach
    void setUp() {
        chatLogRepository = mock(ChatLogRepository.class);
        llmClassifier = mock(LlmIntentClassifier.class);
        settingStepResolver = mock(SettingStepResolver.class);
        videoAccessValidator = mock(VideoAccessValidator.class);
        descriptionService = mock(DescriptionService.class);
        meterRegistry = new SimpleMeterRegistry();
        service = new ChatMessageService(chatLogRepository, new RuleIntentClassifier(), llmClassifier,
                settingStepResolver, videoAccessValidator, descriptionService,
                new TransactionTemplate(mock(PlatformTransactionManager.class)), meterRegistry);

        when(chatLogRepository.save(any())).thenAnswer(invocation -> {
            saved = invocation.getArgument(0);
            ReflectionTestUtils.setField(saved, "id", CHAT_LOG_ID);
            return saved;
        });
        when(chatLogRepository.findById(CHAT_LOG_ID)).thenAnswer(invocation -> Optional.ofNullable(saved));
        when(settingStepResolver.resolve(any(), anyLong())).thenAnswer(invocation -> invocation.getArgument(0));
        Video video = mock(Video.class);
        when(video.getId()).thenReturn(VIDEO_ID);
        when(video.getDurationSec()).thenReturn(300);
        when(videoAccessValidator.getAccessibleVideo(USER, VIDEO_ID)).thenReturn(video);
        when(descriptionService.findPublishedId(VIDEO_ID)).thenReturn(Optional.of(500L));
    }

    @Test
    void 규칙으로_분류되면_LLM을_부르지_않고_기록한다() {
        ChatMessageResponse response = service.receive(USER, inVideo("일시정지", 1000));

        assertThat(response.chatLogId()).isEqualTo(CHAT_LOG_ID);
        assertThat(response.intent()).isEqualTo(ChatIntent.ACTION);
        assertThat(response.result().actionCode()).isEqualTo(ActionCode.PAUSE);
        verify(llmClassifier, never()).classify(anyString(), any());
        assertThat(saved.getIntent()).isEqualTo(ChatIntent.ACTION);
        assertThat(saved.getIntentLatencyMs()).isNotNull();
        assertThat(saved.getDescriptionId()).isEqualTo(500L);
        assertThat(meterRegistry.get("audisay.chat.intent").tag("source", "RULE").timer().count()).isEqualTo(1);
    }

    @Test
    void 규칙으로_모르면_LLM이_분류하고_호출_기록을_챗봇_기록에_건다() {
        when(llmClassifier.classify("반죽 튀기는 데 다시 보고 싶어", CHAT_LOG_ID))
                .thenReturn(ClassifiedIntent.seekScene("반죽 튀기는"));

        ChatMessageResponse response = service.receive(USER, inVideo("반죽 튀기는 데 다시 보고 싶어", 1000));

        assertThat(response.intent()).isEqualTo(ChatIntent.SEEK_SCENE);
        assertThat(saved.getIntent()).isEqualTo(ChatIntent.SEEK_SCENE);
        assertThat(meterRegistry.get("audisay.chat.intent").tag("source", "LLM").timer().count()).isEqualTo(1);
    }

    @Test
    void 질문은_답변_스트림_주소를_준다() {
        ChatMessageResponse response = service.receive(USER, inVideo("저 사람 누구야", 1000));

        assertThat(response.result().answerStreamUrl()).isEqualTo("/api/v1/chat/messages/31/stream");
    }

    @Test
    void 시각_이동은_영상_길이_안에서_계산해_기록한다() {
        ChatMessageResponse response = service.receive(USER, inVideo("30초 뒤로", 290_000));

        assertThat(response.result().targetMs()).isEqualTo(300_000);
        assertThat(saved.getTargetMs()).isEqualTo(300_000);
    }

    @ParameterizedTest(name = "{0} (지금 {1}ms) → {2}")
    @CsvSource({
            "30초 전으로, 10000, 0",
            "10초 뒤로, 60000, 70000",
            "10분으로 가, 0, 300000",
            "끝으로 가, 0, 297000",
            "처음으로, 120000, 0"
    })
    void 이동_시각(String utterance, int nowMs, int expected) {
        assertThat(service.receive(USER, inVideo(utterance, nowMs)).result().targetMs()).isEqualTo(expected);
    }

    @Test
    void 영상_밖에서_영상이_필요한_말은_안내만_한다() {
        ChatMessageResponse response = service.receive(USER, outside("저 사람 누구야"));

        assertThat(response.intent()).isEqualTo(ChatIntent.QUESTION);
        assertThat(response.result().message()).isEqualTo(ChatMessageService.OUTSIDE_VIDEO_MESSAGE);
        assertThat(response.result().answerStreamUrl()).isNull();
        assertThat(saved.getVideoId()).isNull();
    }

    @Test
    void 영상_검색은_영상_밖에서도_검색어를_준다() {
        ChatMessageResponse response = service.receive(USER, outside("치즈케이크 만드는 영상 찾아 줘"));

        assertThat(response.intent()).isEqualTo(ChatIntent.SEARCH_VIDEO);
        assertThat(response.result().query()).isEqualTo("치즈케이크 만드는");
    }

    @Test
    void 해설이_없는_영상에서_질문하면_DESC_001() {
        when(descriptionService.findPublishedId(VIDEO_ID)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.receive(USER, inVideo("저 사람 누구야", 1000)))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode").isEqualTo(ErrorCode.DESCRIPTION_NOT_FOUND);
        assertThat(saved.getIntent()).isEqualTo(ChatIntent.QUESTION);
    }

    @Test
    void 해설이_없어도_재생_조작은_된다() {
        when(descriptionService.findPublishedId(VIDEO_ID)).thenReturn(Optional.empty());

        assertThat(service.receive(USER, inVideo("멈춰", 1000)).result().actionCode()).isEqualTo(ActionCode.PAUSE);
    }

    @Test
    void 알아듣지_못하면_기본_안내() {
        when(llmClassifier.classify(anyString(), any())).thenReturn(ClassifiedIntent.unknown(null));

        assertThat(service.receive(USER, inVideo("음 아 아니에요 됐어요", 1000)).result().message())
                .isEqualTo(ChatMessageService.UNKNOWN_MESSAGE);
    }

    @Test
    void LLM이_실패하면_에러를_그대로_던지고_기록은_UNKNOWN으로_남는다() {
        when(llmClassifier.classify(anyString(), any())).thenThrow(new BusinessException(ErrorCode.CHAT_AI_LIMIT));

        assertThatThrownBy(() -> service.receive(USER, inVideo("음 아 아니에요 됐어요", 1000)))
                .extracting("errorCode").isEqualTo(ErrorCode.CHAT_AI_LIMIT);
        assertThat(saved.getIntent()).isEqualTo(ChatIntent.UNKNOWN);
        assertThat(saved.getIntentLatencyMs()).isNull();
    }

    private static ChatMessageRequest inVideo(String utterance, int videoTimeMs) {
        return new ChatMessageRequest(VIDEO_ID, null, videoTimeMs, utterance, InputMode.TEXT);
    }

    private static ChatMessageRequest outside(String utterance) {
        return new ChatMessageRequest(null, null, null, utterance, InputMode.VOICE);
    }
}
