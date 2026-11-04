package com.audisay.domain.chat.controller;

import com.audisay.domain.chat.dto.request.ChatHistoryRequest;
import com.audisay.domain.chat.dto.response.ChatHistoryResponse;
import com.audisay.domain.chat.service.ChatHistoryService;
import com.audisay.global.response.ApiResponse;
import com.audisay.global.security.AuthUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "챗봇")
@RestController
@RequestMapping("/v1/videos")
@RequiredArgsConstructor
public class ChatHistoryController {
    private final ChatHistoryService chatHistoryService;

    @Operation(summary = "질문 기록 조회",
            description = "이 영상에서 내가 한 입력만 최신순. 모든 intent, answerText는 QUESTION·SCENE_NOW만. "
                    + "다음 페이지는 nextCursor를 cursor로")
    @GetMapping("/{videoId}/chat/messages")
    public ApiResponse<ChatHistoryResponse> getHistory(@AuthenticationPrincipal AuthUser authUser,
                                                       @PathVariable("videoId") Long videoId,
                                                       @Valid @ModelAttribute ChatHistoryRequest request) {
        return ApiResponse.success("질문 기록 조회 성공", chatHistoryService.getHistory(authUser, videoId, request));
    }
}
