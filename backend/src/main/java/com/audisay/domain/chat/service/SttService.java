package com.audisay.domain.chat.service;

import com.audisay.domain.chat.dto.response.SttResponse;
import com.audisay.domain.chat.ratelimit.ChatRateLimiter;
import com.audisay.domain.description.service.VideoAccessValidator;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import com.audisay.global.external.ai.AiServerClient;
import com.audisay.global.external.ai.AiServerException;
import com.audisay.global.external.ai.SttResult;
import com.audisay.global.security.AuthUser;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.time.Duration;
import java.util.Locale;
import java.util.Set;

/**
 * 받아쓰기는 AI 서버 /internal/stt가 한다(H200 faster-whisper → 실패하면 GMS whisper-1).
 * Spring은 형식만 보고 넘긴 뒤 AI 오류를 공개 에러 코드로 바꾼다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SttService {
    /** 브라우저 MediaRecorder가 내는 형식. Chrome은 video/webm으로 줄 때가 있다 */
    private static final Set<String> AUDIO_TYPES = Set.of(
            "audio/webm", "audio/ogg", "audio/mp4", "audio/wav", "audio/x-wav", "audio/wave", "video/webm");

    private final AiServerClient aiServerClient;
    private final MeterRegistry meterRegistry;
    private final ChatRateLimiter rateLimiter;
    private final VideoAccessValidator videoAccessValidator;

    /**
     * 음성 받아쓰기 1분 제한(CHAT_009, 형식 확인 뒤에 센다). 볼 수 없는 영상이면 받아쓰기 힌트(제목·인물 이름)를 쓰지 않는다
     */
    public SttResponse transcribe(AuthUser authUser, MultipartFile audio, Long videoId) {
        if (audio == null || audio.isEmpty()) {
            throw new BusinessException(ErrorCode.SPEECH_NOT_RECOGNIZED, "녹음된 소리가 없어요. 다시 말씀해 주세요.");
        }
        String contentType = audio.getContentType();
        if (contentType == null || !AUDIO_TYPES.contains(baseType(contentType))) {
            throw new BusinessException(ErrorCode.INVALID_AUDIO_FILE, "webm, ogg, mp4, wav 녹음만 받을 수 있습니다.");
        }
        rateLimiter.acquireStt(authUser.userId());

        long start = System.nanoTime();
        SttResult result;
        try {
            result = aiServerClient.transcribe(readBytes(audio), filename(audio), contentType,
                    hintVideoId(authUser, videoId));
        } catch (AiServerException e) {
            ErrorCode errorCode = toErrorCode(e);
            meterRegistry.counter("audisay.stt.failed", "code", errorCode.getCode()).increment();
            throw new BusinessException(errorCode);
        }
        Duration latency = Duration.ofNanos(System.nanoTime() - start);
        if (result == null || !StringUtils.hasText(result.text())) {
            throw new BusinessException(ErrorCode.SPEECH_NOT_RECOGNIZED);
        }
        meterRegistry.timer("audisay.stt", "engine", String.valueOf(result.engine())).record(latency);
        return new SttResponse(result.text().strip(), latency.toMillis());
    }

    /** 힌트로 쓸 영상. 없거나 볼 수 없는 영상이면 null(힌트 없이 받아쓴다) */
    private Long hintVideoId(AuthUser authUser, Long videoId) {
        if (videoId == null) {
            return null;
        }
        try {
            return videoAccessValidator.getAccessibleVideo(authUser, videoId).getId();
        } catch (BusinessException e) {
            log.info("[STT] 볼 수 없는 영상이라 힌트 없이 받아씁니다 userId={} videoId={}", authUser.userId(), videoId);
            return null;
        }
    }

    private static ErrorCode toErrorCode(AiServerException e) {
        return switch (e.getKind()) {
            case TIMEOUT -> ErrorCode.CHAT_AI_TIMEOUT;
            case UNAVAILABLE -> ErrorCode.CHAT_AI_UNAVAILABLE;
            case RESPONSE -> {
                if ("STT_EMPTY".equals(e.getCode())) {
                    yield ErrorCode.SPEECH_NOT_RECOGNIZED;
                }
                if ("STT_FORMAT".equals(e.getCode())) {
                    yield ErrorCode.INVALID_AUDIO_FILE;
                }
                if (e.getStatus() == 429) {
                    yield ErrorCode.CHAT_AI_LIMIT;
                }
                if (e.getStatus() >= 500) {
                    yield ErrorCode.CHAT_AI_UNAVAILABLE;
                }
                // 토큰 불일치(401)·요청 형식 오류(INVALID_REQUEST)는 Spring 쪽 문제
                log.error("[STT] AI 서버가 요청을 거부함 - status={}, code={}, message={}",
                        e.getStatus(), e.getCode(), e.getMessage());
                yield ErrorCode.INTERNAL_SERVER_ERROR;
            }
        };
    }

    private static String baseType(String contentType) {
        int semicolon = contentType.indexOf(';');
        return (semicolon < 0 ? contentType : contentType.substring(0, semicolon)).trim().toLowerCase(Locale.ROOT);
    }

    private static String filename(MultipartFile audio) {
        return StringUtils.hasText(audio.getOriginalFilename()) ? audio.getOriginalFilename() : "voice.webm";
    }

    private static byte[] readBytes(MultipartFile audio) {
        try {
            return audio.getBytes();
        } catch (IOException e) {
            throw new BusinessException(ErrorCode.INVALID_AUDIO_FILE, "녹음 파일을 읽지 못했어요. 다시 말씀해 주세요.");
        }
    }
}
