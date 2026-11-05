package com.audisay.domain.chat.dto.response;

import com.audisay.domain.chat.entity.AnswerSource;
import com.audisay.domain.chat.entity.ChatIntent;
import com.audisay.domain.chat.entity.ChatLog;
import com.audisay.domain.chat.entity.InputMode;

import java.time.Instant;
import java.util.List;

public record ChatHistoryResponse(List<Message> messages, Long nextCursor, boolean hasNext) {

    public static ChatHistoryResponse of(List<ChatLog> rows, int size) {
        boolean hasNext = rows.size() > size;
        List<Message> messages = rows.stream().limit(size).map(Message::from).toList();
        Long nextCursor = hasNext ? messages.getLast().chatLogId() : null;
        return new ChatHistoryResponse(messages, nextCursor, hasNext);
    }

    /**
     * @param answerSource 답을 끝까지 만들었으면 STORED·UNANSWERABLE·FUTURE. 답변 intent인데 null이면 아직 답을 받지 않았거나
     *                     실패·취소된 답(answerText는 받은 데까지) → FE가 "답을 다 받지 못했어요"로 보이고, 같은 chatLogId를
     *                     다시 구독하면 새로 만든다
     */
    public record Message(Long chatLogId, InputMode inputMode, String utterance, ChatIntent intent,
                          Integer videoTimeMs, Integer targetMs, String answerText, AnswerSource answerSource,
                          Instant createdAt) {

        public static Message from(ChatLog log) {
            return new Message(log.getId(), log.getInputMode(), log.getUtterance(), log.getIntent(),
                    log.getVideoTimeMs(), log.getTargetMs(), log.getAnswerText(), log.getAnswerSource(),
                    log.getCreatedAt());
        }
    }
}
