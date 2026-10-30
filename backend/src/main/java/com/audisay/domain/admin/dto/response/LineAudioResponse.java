package com.audisay.domain.admin.dto.response;

/**
 * @param queued 음성 만들기를 line.tts 큐에 넣었는지
 */
public record LineAudioResponse(Long lineId, boolean queued) {
}
