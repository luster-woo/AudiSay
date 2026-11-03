package com.audisay.domain.chat.dto.response;

import com.audisay.domain.chat.entity.ChatIntent;
import com.audisay.domain.chat.entity.InputMode;

public record ChatMessageResponse(Long chatLogId, InputMode inputMode, String utterance, ChatIntent intent,
                                  ChatResult result) {
}
