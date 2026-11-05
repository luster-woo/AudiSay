package com.audisay.global.external.llm.claude;

import com.audisay.global.external.llm.GmsProperties;
import com.audisay.global.external.llm.LlmPurpose;
import com.audisay.global.external.llm.LlmRequest;
import com.audisay.global.external.llm.LlmResult;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import tools.jackson.databind.json.JsonMapper;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 실제 GMS 대체 모델 확인용(크레딧 사용). GMS_LIVE=1, GMS_API_KEY가 있을 때만 돈다.
 */
@EnabledIfEnvironmentVariable(named = "GMS_LIVE", matches = "1")
class ClaudeLiveTest {
    private static final String MODEL = "claude-haiku-5-5";

    private final ClaudeLlmProvider provider = new ClaudeLlmProvider(new GmsProperties(GmsProperties.Mode.REAL,
            System.getenv("GMS_API_KEY"), null, "https://gms.ssafy.io/gmsapi/api.anthropic.com",
            Duration.ofSeconds(2), 0, null, new GmsProperties.Models(MODEL, MODEL, MODEL),
            new GmsProperties.Timeouts(Duration.ofSeconds(5), Duration.ofSeconds(10), Duration.ofSeconds(60)),
            Duration.ofSeconds(10), Map.of(), null, null, null), JsonMapper.builder().build());

    @Test
    void 분류_JSON() {
        LlmResult result = provider.generate(LlmRequest.json(LlmPurpose.INTENT,
                "말을 분류해 설명 없이 JSON 한 개만 답하세요: {\"intent\": \"QUESTION\" 또는 \"ACTION\"}", "말: 지금 멈춰", 50),
                MODEL);

        System.out.printf("[LIVE-CLAUDE] generate %dms in=%d out=%d text=%s%n",
                result.latencyMs(), result.inputTokens(), result.outputTokens(), oneLine(result.text()));
        assertThat(result.text()).startsWith("{").contains("intent");
    }

    @Test
    void 답변_스트리밍() {
        List<Long> arrivals = new ArrayList<>();
        long start = System.nanoTime();
        LlmResult result = provider.stream(LlmRequest.text(LlmPurpose.ANSWER, "한국어로 세 문장으로 답하세요.",
                "츄러스를 튀길 때 주의할 점은?", 300), MODEL, delta -> {
            arrivals.add((System.nanoTime() - start) / 1_000_000);
            return true;
        });

        System.out.printf("[LIVE-CLAUDE] stream %dms chunks=%d firstChunk=%dms in=%d out=%d text=%s%n",
                result.latencyMs(), arrivals.size(), arrivals.isEmpty() ? -1 : arrivals.get(0), result.inputTokens(),
                result.outputTokens(), oneLine(result.text()));
        assertThat(result.text()).isNotBlank();
    }

    private static String oneLine(String text) {
        return text.replaceAll("\\s+", " ");
    }
}
