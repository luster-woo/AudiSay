package com.audisay.domain.chat.controller;

import com.audisay.domain.chat.dto.request.TtsRequest;
import com.audisay.domain.chat.dto.response.TtsResponse;
import com.audisay.domain.chat.service.TtsService;
import com.audisay.global.response.ApiResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "챗봇")
@RestController
@RequestMapping("/v1")
@RequiredArgsConstructor
public class TtsController {
    private final TtsService ttsService;

    @Operation(summary = "안내 목소리 생성", description = "화면 안내 문장을 음성으로. 만들지 못하면 audioUrl null(브라우저 음성으로 읽기)")
    @PostMapping("/tts")
    public ApiResponse<TtsResponse> synthesize(@Valid @RequestBody TtsRequest request) {
        TtsResponse response = ttsService.synthesize(request);
        String message = response.hasAudio() ? "안내 음성 생성 성공" : "음성을 만들지 못했어요. 브라우저 음성으로 읽어 주세요.";
        return ApiResponse.success(message, response);
    }
}
