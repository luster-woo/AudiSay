package com.audisay.domain.chat.controller;

import com.audisay.domain.chat.dto.request.ChatMessageRequest;
import com.audisay.domain.chat.dto.response.ChatMessageResponse;
import com.audisay.domain.chat.service.ChatMessageService;
import com.audisay.global.response.ApiResponse;
import com.audisay.global.security.AuthUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "챗봇")
@RestController
@RequestMapping("/v1/chat")
@RequiredArgsConstructor
public class ChatMessageController {
    private final ChatMessageService chatMessageService;

    @Operation(summary = "챗봇 입력(발화 분석)",
            description = "말을 QUESTION·SCENE_NOW·SEEK_TIME·SEEK_SCENE·SETTING·ACTION·SEARCH_VIDEO·UNKNOWN으로 분류하고 "
                    + "intent마다 FE가 할 일을 result로 준다. 규칙으로 먼저 분류하고 안 되면 LLM(gemini-3.1-flash-lite)")
    @PostMapping("/messages")
    public ApiResponse<ChatMessageResponse> receive(@AuthenticationPrincipal AuthUser authUser,
                                                    @Valid @RequestBody ChatMessageRequest request) {
        return ApiResponse.success("발화 분석 성공", chatMessageService.receive(authUser, request));
    }
}
