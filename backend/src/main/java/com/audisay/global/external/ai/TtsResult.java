package com.audisay.global.external.ai;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * @param audioUrl presigned GET(6시간). 만들지 못했으면 null이고 reason에 TTS_002(H200 꺼짐)·TTS_003(H200 실패)
 * @param cached   같은 문장·목소리 저장본을 다시 썼는지
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record TtsResult(String audioUrl, String audioKey, Integer durationMs, boolean cached, String reason) {
}
