package com.audisay.domain.chat.service;

import com.audisay.domain.chat.dto.request.ChatHistoryRequest;
import com.audisay.domain.chat.dto.response.ChatHistoryResponse;
import com.audisay.domain.chat.entity.ChatLog;
import com.audisay.domain.chat.repository.ChatLogRepository;
import com.audisay.domain.description.service.VideoAccessValidator;
import com.audisay.global.security.AuthUser;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@RequiredArgsConstructor
public class ChatHistoryService {
    private final ChatLogRepository chatLogRepository;
    private final VideoAccessValidator videoAccessValidator;

    @Transactional(readOnly = true)
    public ChatHistoryResponse getHistory(AuthUser authUser, Long videoId, ChatHistoryRequest request) {
        videoAccessValidator.getAccessibleVideo(authUser, videoId);
        int size = request.sizeOrDefault();
        long cursor = request.cursor() == null ? Long.MAX_VALUE : request.cursor();
        List<ChatLog> rows = chatLogRepository.findByUserIdAndVideoIdAndIdLessThanOrderByIdDesc(
                authUser.userId(), videoId, cursor, Limit.of(size + 1));
        return ChatHistoryResponse.of(rows, size);
    }
}
