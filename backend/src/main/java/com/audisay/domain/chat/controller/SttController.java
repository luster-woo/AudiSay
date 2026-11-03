package com.audisay.domain.chat.controller;

import com.audisay.domain.chat.dto.response.SttResponse;
import com.audisay.domain.chat.service.SttService;
import com.audisay.global.response.ApiResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@Tag(name = "챗봇")
@RestController
@RequestMapping("/v1")
@RequiredArgsConstructor
public class SttController {
    private final SttService sttService;

    @Operation(summary = "음성 입력 변환(STT)", description = "녹음(webm/ogg/mp4/wav, 10MB 이하)을 글자로. videoId가 있으면 영상 제목·인물 이름을 받아쓰기 힌트로 쓴다")
    @PostMapping(value = "/stt", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ApiResponse<SttResponse> transcribe(@RequestPart("audio") MultipartFile audio,
                                               @RequestParam(value = "videoId", required = false) Long videoId) {
        return ApiResponse.success("음성 변환 성공", sttService.transcribe(audio, videoId));
    }
}
