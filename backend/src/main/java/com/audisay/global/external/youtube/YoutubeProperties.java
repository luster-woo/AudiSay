package com.audisay.global.external.youtube;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * YouTube Data API v3 설정 (application.yml의 audisay.youtube).
 *
 * @param apiKey 비어 있으면 유튜브 호출이 실패한다(로컬은 .env의 YOUTUBE_API_KEY)
 */
@ConfigurationProperties("audisay.youtube")
public record YoutubeProperties(String apiKey, String baseUrl, Duration connectTimeout, Duration readTimeout) {
}
