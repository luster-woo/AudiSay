package com.audisay.global.external.ai;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * AI 서버 내부 API 설정 (application.yml의 audisay.ai).
 *
 * @param internalToken 모든 요청의 X-Internal-Token 헤더. AI 서버와 같은 AI_INTERNAL_TOKEN 값
 */
@ConfigurationProperties("audisay.ai")
public record AiServerProperties(String baseUrl, String internalToken, Duration connectTimeout, Duration sttTimeout) {
}
