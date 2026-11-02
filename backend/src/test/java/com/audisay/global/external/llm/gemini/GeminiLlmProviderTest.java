package com.audisay.global.external.llm.gemini;

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
import static com.github.tomakehurst.wiremock.client.WireMock.okJson;
import static com.github.tomakehurst.wiremock.client.WireMock.post;
import static com.github.tomakehurst.wiremock.client.WireMock.postRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.status;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.options;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class GeminiLlmProviderTest {
    private static final String MODEL = "test-model";
    private static final String GENERATE = "/v1beta/models/" + MODEL + ":generateContent";
    private static final String STREAM = "/v1beta/models/" + MODEL + ":streamGenerateContent";
    // 첫 요청은 WireMock·HttpClient가 데워지느라 느릴 수 있어 넉넉히. 시간 초과 테스트는 이보다 길게 늦춘다
    private static final Duration TIMEOUT = Duration.ofSeconds(2);
    private static final int SLOW_MS = 3500;

    private static WireMockServer server;
    private GeminiLlmProvider provider;

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
        GmsProperties properties = new GmsProperties(GmsProperties.Mode.REAL, "test-key", server.baseUrl(), null,
                Duration.ofSeconds(1), 0,
                new GmsProperties.Models(MODEL, MODEL, MODEL),
                new GmsProperties.Timeouts(TIMEOUT, TIMEOUT, TIMEOUT), TIMEOUT, Map.of(), null, null, null);
        provider = new GeminiLlmProvider(properties, JsonMapper.builder().build());
    }

    @AfterEach
    void tearDown() {
        provider.shutdown();
    }

    @Test
    void generate_글과_사용량을_읽고_JSON_응답과_추론_끄기를_보낸다() {
        server.stubFor(post(urlPathEqualTo(GENERATE)).willReturn(okJson("""
                {"candidates":[{"content":{"parts":[{"text":"생각","thought":true},{"text":"{\\"intent\\":\\"QUESTION\\"}"}]},"finishReason":"STOP"}],
                 "usageMetadata":{"promptTokenCount":440,"candidatesTokenCount":20,"thoughtsTokenCount":3}}""")));

        LlmResult result = provider.generate(LlmRequest.json(LlmPurpose.INTENT, "분류하세요", "말: 다음 장면", 200), MODEL);

        assertThat(result.text()).isEqualTo("{\"intent\":\"QUESTION\"}");
        assertThat(result.inputTokens()).isEqualTo(440);
        assertThat(result.outputTokens()).isEqualTo(23);
        assertThat(result.model()).isEqualTo(MODEL);
        server.verify(postRequestedFor(urlPathEqualTo(GENERATE))
                .withHeader("x-goog-api-key", equalTo("test-key"))
                .withRequestBody(matchingJsonPath("$.generationConfig.responseMimeType", equalTo("application/json")))
                .withRequestBody(matchingJsonPath("$.generationConfig.thinkingConfig.thinkingBudget", equalTo("0")))
                .withRequestBody(matchingJsonPath("$.systemInstruction.parts[0].text", equalTo("분류하세요"))));
    }

    @Test
    void generate_429는_RATE_LIMIT() {
        server.stubFor(post(urlPathEqualTo(GENERATE)).willReturn(status(429).withBody("{\"statusCode\":429}")));

        assertKind(() -> provider.generate(intent(), MODEL), Kind.RATE_LIMIT);
    }

    @Test
    void generate_5xx는_UNAVAILABLE() {
        server.stubFor(post(urlPathEqualTo(GENERATE)).willReturn(status(503)));

        assertKind(() -> provider.generate(intent(), MODEL), Kind.UNAVAILABLE);
    }

    @Test
    void generate_시간_초과는_TIMEOUT() {
        server.stubFor(post(urlPathEqualTo(GENERATE)).willReturn(okJson("{}").withFixedDelay(SLOW_MS)));

        assertKind(() -> provider.generate(intent(), MODEL), Kind.TIMEOUT);
    }

    @Test
    void generate_안전_정책_거부는_BLOCKED() {
        server.stubFor(post(urlPathEqualTo(GENERATE)).willReturn(okJson(
                "{\"promptFeedback\":{\"blockReason\":\"SAFETY\"},\"usageMetadata\":{\"promptTokenCount\":10}}")));

        assertKind(() -> provider.generate(intent(), MODEL), Kind.BLOCKED);
    }

    @Test
    void stream_조각마다_handler를_부르고_마지막_사용량을_쓴다() {
        server.stubFor(post(urlPathEqualTo(STREAM)).withQueryParam("alt", equalTo("sse"))
                .willReturn(aResponse().withHeader("Content-Type", "text/event-stream").withBody(sse(
                        "{\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"170도에서 \"}]}}]}",
                        "{\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"튀겨요.\"}]},\"finishReason\":\"STOP\"}],"
                                + "\"usageMetadata\":{\"promptTokenCount\":680,\"candidatesTokenCount\":17}}"))));
        List<String> deltas = new ArrayList<>();

        LlmResult result = provider.stream(answer(), MODEL, deltas::add);

        assertThat(deltas).containsExactly("170도에서 ", "튀겨요.");
        assertThat(result.text()).isEqualTo("170도에서 튀겨요.");
        assertThat(result.inputTokens()).isEqualTo(680);
        assertThat(result.outputTokens()).isEqualTo(17);
        assertThat(result.cancelled()).isFalse();
    }

    @Test
    void stream_handler가_false면_멈추고_받은_데까지() {
        server.stubFor(post(urlPathEqualTo(STREAM)).willReturn(aResponse()
                .withHeader("Content-Type", "text/event-stream").withBody(sse(
                        "{\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"첫 문장.\"}]}}]}",
                        "{\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"둘째 문장.\"}]}}]}"))));

        LlmResult result = provider.stream(answer(), MODEL, delta -> false);

        assertThat(result.text()).isEqualTo("첫 문장.");
        assertThat(result.cancelled()).isTrue();
    }

    @Test
    void stream_시간_초과는_TIMEOUT() {
        server.stubFor(post(urlPathEqualTo(STREAM)).willReturn(aResponse()
                .withHeader("Content-Type", "text/event-stream")
                .withBody(sse("{\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"늦은 답\"}]}}]}"))
                .withFixedDelay(SLOW_MS)));

        assertKind(() -> provider.stream(answer(), MODEL, delta -> true), Kind.TIMEOUT);
    }

    @Test
    void stream_429는_RATE_LIMIT() {
        server.stubFor(post(urlPathEqualTo(STREAM)).willReturn(status(429)));

        assertKind(() -> provider.stream(answer(), MODEL, delta -> true), Kind.RATE_LIMIT);
    }

    private static LlmRequest intent() {
        return LlmRequest.json(LlmPurpose.INTENT, "분류하세요", "말: 다음 장면", 200);
    }

    private static LlmRequest answer() {
        return LlmRequest.text(LlmPurpose.ANSWER, "답하세요", "질문: 몇 도에서 튀겨?", 300);
    }

    private static String sse(String... events) {
        StringBuilder body = new StringBuilder();
        for (String event : events) {
            body.append("data: ").append(event).append("\r\n\r\n");
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
