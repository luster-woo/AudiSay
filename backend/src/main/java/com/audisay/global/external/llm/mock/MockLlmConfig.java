package com.audisay.global.external.llm.mock;

import com.audisay.global.external.llm.GmsProperties;
import com.audisay.global.external.llm.LlmProvider;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * audisay.gms.mode=mock: 주·대체 모델 모두 가짜. audisay.gms.mock.failure는 주 모델에만 걸어서
 * "주 모델 장애 → 대체 모델로 성공"을 크레딧 없이 흉내 낼 수 있다.
 */
@Slf4j
@Configuration
@ConditionalOnProperty(prefix = "audisay.gms", name = "mode", havingValue = "mock")
public class MockLlmConfig {

    @Bean("primaryLlmProvider")
    LlmProvider primaryLlmProvider(GmsProperties properties) {
        log.warn("[LLM] GMS mock 모드입니다. 챗봇 LLM을 부르지 않고 가짜 응답을 줍니다 (audisay.gms.mode=mock, 주 모델 장애 주입={})",
                properties.mock().failure());
        return new FakeLlmProvider("mock", properties.mock().latency(), properties.mock().failure());
    }

    @Bean("fallbackLlmProvider")
    LlmProvider fallbackLlmProvider(GmsProperties properties) {
        return new FakeLlmProvider("mock-fallback", properties.mock().latency(), null);
    }
}
