package com.audisay.global.external.ai;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * @param engine H200(오픈소스 받아쓰기) 또는 GMS(whisper-1 대체)
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record SttResult(String text, Integer latencyMs, String engine) {
}
