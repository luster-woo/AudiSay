package com.audisay.global.external.llm.claude;

import com.audisay.global.external.llm.GmsProperties;
import com.audisay.global.external.llm.LlmException;
import com.audisay.global.external.llm.LlmException.Kind;
import com.audisay.global.external.llm.LlmPurpose;
import com.audisay.global.external.llm.LlmRequest;
import com.audisay.global.external.llm.LlmResult;
import com.github.tomakehurst.wiremock.WireMockServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.equalTo;
import static com.github.tomakehurst.wiremock.client.WireMock.matchingJsonPath;
import static com.github.tomakehurst.wiremock.client.WireMock.notMatching;
import static com.github.tomakehurst.wiremock.client.WireMock.okJson;
import static com.github.tomakehurst.wiremock.client.WireMock.post;
import static com.github.tomakehurst.wiremock.client.WireMock.postRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.status;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.options;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ClaudeLlmProviderTest {
    private static final String MODEL = "claude-haiku-5-5";
    private static final String URI = "/v1/messages";
    private static final Duration TIMEOUT = Duration.ofSeconds(2);

    private static WireMockServer server;
    private ClaudeLlmProvider provider;

    @BeforeAll
    static void startServer() {
        server = new WireMockServer(options().dynamicPort());
        server.start();
    }

    @AfterAll
    static void stopServer() {
        server.stop();
    }

    @BeforeEach
    void setUp() {
        server.resetAll();
        GmsProperties properties = new GmsProperties(GmsProperties.Mode.REAL, "test-key", null, server.baseUrl(),
                Duration.ofSeconds(1), 0, null, new GmsProperties.Models(MODEL, MODEL, MODEL),
                new GmsProperties.Timeouts(TIMEOUT, TIMEOUT, TIMEOUT), TIMEOUT, Map.of(), null, null, null);
        provider = new ClaudeLlmProvider(properties, JsonMapper.builder().build());
    }

    @AfterEach
    void tearDown() {
        provider.shutdown();
    }

    @Test
    void generate_글과_사용량을_읽고_코드_블록을_벗기며_추론을_끈다() {
        server.stubFor(post(urlPathEqualTo(URI)).willReturn(okJson("""
                {"content":[{"type":"text","text":"```json\\n{\\"intent\\": \\"ACTION\\"}\\n```"}],
                 "stop_reason":"end_turn","usage":{"input_tokens":816,"output_tokens":34}}""")));

        LlmResult result = provider.generate(LlmRequest.json(LlmPurpose.INTENT, "분류하세요", "말: 멈춰", 200), MODEL);

        assertThat(result.text()).isEqualTo("{\"intent\": \"ACTION\"}");
        assertThat(result.inputTokens()).isEqualTo(816);
        assertThat(result.outputTokens()).isEqualTo(34);
        server.verify(postRequestedFor(urlPathEqualTo(URI))
                .withHeader("x-api-key", equalTo("test-key"))
                .withHeader("anthropic-version", equalTo("2023-06-01"))
                .withRequestBody(matchingJsonPath("$.model", equalTo(MODEL)))
                .withRequestBody(matchingJsonPath("$.max_tokens", equalTo("200")))
                .withRequestBody(matchingJsonPath("$.thinking.type", equalTo("disabled")))
                .withRequestBody(notMatching(".*temperature.*"))
                .withRequestBody(matchingJsonPath("$.system", equalTo("분류하세요"))));
    }

    @Test
    void generate_429는_RATE_LIMIT() {
        server.stubFor(post(urlPathEqualTo(URI)).willReturn(status(429)
                .withBody("{\"type\":\"error\",\"error\":{\"type\":\"rate_limit_error\"}}")));

        assertKind(() -> provider.generate(intent(), MODEL), Kind.RATE_LIMIT);
    }

    @Test
    void generate_과부하_529는_UNAVAILABLE() {
        server.stubFor(post(urlPathEqualTo(URI)).willReturn(status(529)));

        assertKind(() -> provider.generate(intent(), MODEL), Kind.UNAVAILABLE);
    }

    @Test
    void generate_거부는_BLOCKED() {
        server.stubFor(post(urlPathEqualTo(URI)).willReturn(okJson(
                "{\"content\":[],\"stop_reason\":\"refusal\",\"usage\":{\"input_tokens\":10,\"output_tokens\":0}}")));

        assertKind(() -> provider.generate(intent(), MODEL), Kind.BLOCKED);
    }

    @Test
    void stream_글_조각과_입출력_토큰을_모은다() {
        server.stubFor(post(urlPathEqualTo(URI)).willReturn(aResponse()
                .withHeader("Content-Type", "text/event-stream").withBody(sse(
                        "message_start", "{\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":1071,\"output_tokens\":1}}}",
                        "content_block_start", "{\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}",
                        "ping", "{\"type\":\"ping\"}",
                        "content_block_delta", "{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"170도에서 \"}}",
                        "content_block_delta", "{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"튀겨요.\"}}",
                        "message_delta", "{\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":49}}",
                        "message_stop", "{\"type\":\"message_stop\"}"))));
        List<String> deltas = new ArrayList<>();

        LlmResult result = provider.stream(answer(), MODEL, deltas::add);

        assertThat(deltas).containsExactly("170도에서 ", "튀겨요.");
        assertThat(result.text()).isEqualTo("170도에서 튀겨요.");
        assertThat(result.inputTokens()).isEqualTo(1071);
        assertThat(result.outputTokens()).isEqualTo(49);
        server.verify(postRequestedFor(urlPathEqualTo(URI)).withRequestBody(matchingJsonPath("$.stream", equalTo("true"))));
    }

    @Test
    void stream_도중_과부하_이벤트는_UNAVAILABLE() {
        server.stubFor(post(urlPathEqualTo(URI)).willReturn(aResponse()
                .withHeader("Content-Type", "text/event-stream").withBody(sse(
                        "message_start", "{\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":10}}}",
                        "error", "{\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}"))));

        assertKind(() -> provider.stream(answer(), MODEL, delta -> true), Kind.UNAVAILABLE);
    }

    @Test
    void 코드_블록이_없으면_그대로() {
        assertThat(ClaudeLlmProvider.unwrapCodeBlock(" {\"n\": [3]} ")).isEqualTo("{\"n\": [3]}");
        assertThat(ClaudeLlmProvider.unwrapCodeBlock("```\n{\"n\": []}\n```")).isEqualTo("{\"n\": []}");
    }

    private static LlmRequest intent() {
        return LlmRequest.json(LlmPurpose.INTENT, "분류하세요", "말: 다음 장면", 200);
    }

    private static LlmRequest answer() {
        return LlmRequest.text(LlmPurpose.ANSWER, "답하세요", "질문: 몇 도에서 튀겨?", 300);
    }

    /** event 이름과 data를 번갈아 넣는다 */
    private static String sse(String... eventAndData) {
        StringBuilder body = new StringBuilder();
        for (int i = 0; i < eventAndData.length; i += 2) {
            body.append("event: ").append(eventAndData[i]).append("\n")
                    .append("data: ").append(eventAndData[i + 1]).append("\n\n");
        }
        return body.toString();
    }

    private static void assertKind(Runnable call, Kind kind) {
        assertThatThrownBy(call::run)
                .isInstanceOf(LlmException.class)
                .extracting(e -> ((LlmException) e).getKind())
                .isEqualTo(kind);
    }
}
