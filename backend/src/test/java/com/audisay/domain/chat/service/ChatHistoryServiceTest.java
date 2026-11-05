package com.audisay.domain.chat.service;

import com.audisay.domain.chat.dto.request.ChatHistoryRequest;
import com.audisay.domain.chat.dto.response.ChatHistoryResponse;
import com.audisay.domain.chat.entity.AnswerSource;
import com.audisay.domain.chat.entity.ChatIntent;
import com.audisay.domain.chat.entity.ChatLog;
import com.audisay.domain.chat.entity.InputMode;
import com.audisay.domain.chat.repository.ChatLogRepository;
import com.audisay.domain.description.service.VideoAccessValidator;
import com.audisay.domain.user.entity.Role;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import com.audisay.global.security.AuthUser;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Limit;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.stream.LongStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ChatHistoryServiceTest {
    private static final AuthUser USER = new AuthUser(2L, Role.GENERAL, "sid");
    private static final long VIDEO_ID = 9401L;

    private ChatLogRepository chatLogRepository;
    private VideoAccessValidator videoAccessValidator;
    private ChatHistoryService service;

    @BeforeEach
    void setUp() {
        chatLogRepository = mock(ChatLogRepository.class);
        videoAccessValidator = mock(VideoAccessValidator.class);
        service = new ChatHistoryService(chatLogRepository, videoAccessValidator);
    }

    @Test
    void 첫_페이지는_커서_없이_size보다_하나_더_읽고_넘치면_다음_커서를_준다() {
        List<ChatLog> rows = logs(30, 29, 28);
        when(chatLogRepository.findByUserIdAndVideoIdAndIdLessThanOrderByIdDesc(
                2L, VIDEO_ID, Long.MAX_VALUE, Limit.of(3))).thenReturn(rows);

        ChatHistoryResponse response = service.getHistory(USER, VIDEO_ID, new ChatHistoryRequest(null, 2));

        assertThat(response.messages()).extracting(ChatHistoryResponse.Message::chatLogId).containsExactly(30L, 29L);
        assertThat(response.hasNext()).isTrue();
        assertThat(response.nextCursor()).isEqualTo(29L);
    }

    @Test
    void 마지막_페이지면_hasNext_false_nextCursor_null() {
        when(chatLogRepository.findByUserIdAndVideoIdAndIdLessThanOrderByIdDesc(
                2L, VIDEO_ID, 29L, Limit.of(3))).thenReturn(logs(28));

        ChatHistoryResponse response = service.getHistory(USER, VIDEO_ID, new ChatHistoryRequest(29L, 2));

        assertThat(response.messages()).hasSize(1);
        assertThat(response.hasNext()).isFalse();
        assertThat(response.nextCursor()).isNull();
    }

    @Test
    void size를_비우면_20개() {
        when(chatLogRepository.findByUserIdAndVideoIdAndIdLessThanOrderByIdDesc(
                2L, VIDEO_ID, Long.MAX_VALUE, Limit.of(21)))
                .thenReturn(logs(LongStream.rangeClosed(1, 21).map(i -> 22 - i).toArray()));

        ChatHistoryResponse response = service.getHistory(USER, VIDEO_ID, new ChatHistoryRequest(null, null));

        assertThat(response.messages()).hasSize(20);
        assertThat(response.nextCursor()).isEqualTo(2L);
    }

    @Test
    void 기록이_없으면_빈_목록() {
        when(chatLogRepository.findByUserIdAndVideoIdAndIdLessThanOrderByIdDesc(
                anyLong(), anyLong(), anyLong(), any())).thenReturn(List.of());

        ChatHistoryResponse response = service.getHistory(USER, VIDEO_ID, new ChatHistoryRequest(null, null));

        assertThat(response.messages()).isEmpty();
        assertThat(response.hasNext()).isFalse();
        assertThat(response.nextCursor()).isNull();
    }

    @Test
    void 답변과_이동_시각을_그대로_담는다() {
        ChatLog question = log(12, ChatIntent.QUESTION);
        question.answer("주인공은 민수예요.", AnswerSource.STORED, 900, 1500);
        when(chatLogRepository.findByUserIdAndVideoIdAndIdLessThanOrderByIdDesc(
                anyLong(), anyLong(), anyLong(), any())).thenReturn(List.of(question));

        ChatHistoryResponse.Message message =
                service.getHistory(USER, VIDEO_ID, new ChatHistoryRequest(null, null)).messages().getFirst();

        assertThat(message.intent()).isEqualTo(ChatIntent.QUESTION);
        assertThat(message.inputMode()).isEqualTo(InputMode.TEXT);
        assertThat(message.videoTimeMs()).isEqualTo(200_000);
        assertThat(message.answerText()).isEqualTo("주인공은 민수예요.");
        assertThat(message.answerSource()).isEqualTo(AnswerSource.STORED);
    }

    @Test
    void 볼_수_없는_영상이면_기록을_읽지_않는다() {
        when(videoAccessValidator.getAccessibleVideo(USER, VIDEO_ID))
                .thenThrow(new BusinessException(ErrorCode.VIDEO_PRIVATE));

        assertThatThrownBy(() -> service.getHistory(USER, VIDEO_ID, new ChatHistoryRequest(null, null)))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode").isEqualTo(ErrorCode.VIDEO_PRIVATE);
        verify(chatLogRepository, never()).findByUserIdAndVideoIdAndIdLessThanOrderByIdDesc(
                anyLong(), eq(VIDEO_ID), anyLong(), any());
    }

    private List<ChatLog> logs(long... ids) {
        return LongStream.of(ids).mapToObj(id -> log(id, ChatIntent.SEEK_TIME)).toList();
    }

    private ChatLog log(long id, ChatIntent intent) {
        ChatLog chat = ChatLog.receive(2L, VIDEO_ID, 1L, 200_000, InputMode.TEXT, "질문 " + id);
        chat.classify(intent, 10);
        ReflectionTestUtils.setField(chat, "id", id);
        return chat;
    }
}
