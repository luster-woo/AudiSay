package com.audisay.domain.chat.dto.response;

/**
 * @param audioUrl 만들지 못했으면 null → FE가 브라우저 음성으로 읽는다
 */
public record TtsResponse(String audioUrl, Integer durationMs, long latencyMs) {
    public boolean hasAudio() {
        return audioUrl != null;
    }
}
