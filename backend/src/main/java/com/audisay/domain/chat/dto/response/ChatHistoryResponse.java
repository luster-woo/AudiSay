package com.audisay.domain.chat.dto.response;

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

    public record Message(Long chatLogId, InputMode inputMode, String utterance, ChatIntent intent,
                          Integer videoTimeMs, Integer targetMs, String answerText, Instant createdAt) {

        public static Message from(ChatLog log) {
            return new Message(log.getId(), log.getInputMode(), log.getUtterance(), log.getIntent(),
                    log.getVideoTimeMs(), log.getTargetMs(), log.getAnswerText(), log.getCreatedAt());
        }
    }
}
