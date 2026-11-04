package com.audisay.domain.chat.controller;

import com.audisay.domain.chat.answer.ChatAnswerService;
import com.audisay.domain.chat.dto.request.ChatMessageRequest;
import com.audisay.domain.chat.dto.response.ChatMessageResponse;
import com.audisay.domain.chat.service.ChatMessageService;
import com.audisay.global.response.ApiResponse;
import com.audisay.global.security.AuthUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@Tag(name = "챗봇")
@RestController
@RequestMapping("/v1/chat")
@RequiredArgsConstructor
public class ChatMessageController {
    private final ChatMessageService chatMessageService;
    private final ChatAnswerService chatAnswerService;

    @Operation(summary = "챗봇 입력(발화 분석)",
            description = "말을 QUESTION·SCENE_NOW·SEEK_TIME·SEEK_SCENE·SETTING·ACTION·SEARCH_VIDEO·UNKNOWN으로 분류하고 "
                    + "intent마다 FE가 할 일을 result로 준다. 규칙으로 먼저 분류하고 안 되면 LLM(gemini-3.1-flash-lite)")
    @PostMapping("/messages")
    public ApiResponse<ChatMessageResponse> receive(@AuthenticationPrincipal AuthUser authUser,
                                                    @Valid @RequestBody ChatMessageRequest request) {
        return ApiResponse.success("발화 분석 성공", chatMessageService.receive(authUser, request));
    }

    @Operation(summary = "질문 답변 받기 (SSE)",
            description = "QUESTION·SCENE_NOW 답변. delta(글자 조각) / sentence(문장 + 음성 주소) / done / error. "
                    + "이미 끝난 답변이면 done만. 같은 chatLogId를 동시에 구독하면 CHAT_008. "
                    + "질문한 시각까지 자료로 답하지 못하고 뒤에 답이 있으면 done.futureAvailable=true → includeFuture=true로 한 번 더(CHAT_010)")
    @GetMapping("/messages/{chatLogId}/stream")
    public ResponseEntity<SseEmitter> stream(@AuthenticationPrincipal AuthUser authUser,
                                             @PathVariable("chatLogId") Long chatLogId,
                                             @RequestParam(value = "includeFuture", defaultValue = "false")
                                             boolean includeFuture) {
        return ResponseEntity.ok()
                .header("Cache-Control", "no-cache")
                .header("X-Accel-Buffering", "no")
                .body(chatAnswerService.subscribe(authUser, chatLogId, includeFuture));
    }
}
