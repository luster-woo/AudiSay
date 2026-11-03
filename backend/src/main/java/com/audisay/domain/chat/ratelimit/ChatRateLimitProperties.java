package com.audisay.domain.chat.ratelimit;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * @param requestsPerMinute 회원당 1분 챗봇 입력 수(기본 30)
 * @param llmCallsPerMinute 회원당 1분 LLM 호출 수(기본 10, 발화 분류·장면 선택)
 */
@ConfigurationProperties("audisay.chat.rate-limit")
public record ChatRateLimitProperties(Integer requestsPerMinute, Integer llmCallsPerMinute) {

    public ChatRateLimitProperties {
        requestsPerMinute = requestsPerMinute == null ? 30 : requestsPerMinute;
        llmCallsPerMinute = llmCallsPerMinute == null ? 10 : llmCallsPerMinute;
    }
}
