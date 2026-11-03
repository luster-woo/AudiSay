package com.audisay.domain.chat.service;

import com.audisay.domain.chat.dto.request.TtsRequest;
import com.audisay.domain.chat.dto.response.TtsResponse;
import com.audisay.global.external.ai.AiServerClient;
import com.audisay.global.external.ai.AiServerException;
import com.audisay.global.external.ai.TtsResult;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Duration;

/**
 * 안내 목소리는 AI 서버 /internal/tts가 만든다(H200 Supertonic, 같은 문장은 저장본 재사용).
 * 실패해도 오류 대신 audioUrl null로 응답해 FE가 브라우저 음성으로 읽게 한다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class TtsService {
    private static final String DEFAULT_VOICE = "F1";

    private final AiServerClient aiServerClient;
    private final MeterRegistry meterRegistry;

    public TtsResponse synthesize(TtsRequest request) {
        String voice = request.voice() == null ? DEFAULT_VOICE : request.voice();
        long start = System.nanoTime();
        TtsResult result = call(request.text(), voice);
        Duration latency = Duration.ofNanos(System.nanoTime() - start);

        meterRegistry.timer("audisay.tts", "result", outcome(result)).record(latency);
        if (result == null || result.audioUrl() == null) {
            return new TtsResponse(null, null, latency.toMillis());
        }
        return new TtsResponse(result.audioUrl(), result.durationMs(), latency.toMillis());
    }

    private TtsResult call(String text, String voice) {
        try {
            return aiServerClient.synthesize(text, voice);
        } catch (AiServerException e) {
            // TTS_001(기호만 있어 읽을 글자가 없음)·시간 초과·연결 실패는 브라우저 음성으로 넘기면 된다
            boolean ourFault = e.getKind() == AiServerException.Kind.RESPONSE
                    && e.getStatus() < 500 && !"TTS_001".equals(e.getCode());
            if (ourFault) {
                log.error("[TTS] AI 서버가 요청을 거부함 - status={}, code={}, message={}", e.getStatus(), e.getCode(), e.getMessage());
            } else {
                log.warn("[TTS] 안내 음성 실패 - kind={}, code={}", e.getKind(), e.getCode());
            }
            return null;
        }
    }

    private static String outcome(TtsResult result) {
        if (result == null) {
            return "error";
        }
        if (result.audioUrl() == null) {
            return result.reason() == null ? "none" : result.reason();
        }
        return result.cached() ? "cached" : "made";
    }
}
