package com.audisay.global.external.embedding;

import com.audisay.global.aicall.AiCallLog;
import com.audisay.global.aicall.AiCallPurpose;
import com.audisay.global.aicall.AiCallRecorder;
import com.audisay.global.external.llm.GmsProperties;
import com.audisay.global.external.llm.LlmException;
import com.audisay.global.external.llm.LlmException.Kind;
import com.github.tomakehurst.wiremock.WireMockServer;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import tools.jackson.databind.json.JsonMapper;

import java.math.BigDecimal;
import java.time.Duration;
import java.util.List;
import java.util.Map;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.equalTo;
import static com.github.tomakehurst.wiremock.client.WireMock.matchingJsonPath;
import static com.github.tomakehurst.wiremock.client.WireMock.okJson;
import static com.github.tomakehurst.wiremock.client.WireMock.post;
import static com.github.tomakehurst.wiremock.client.WireMock.postRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.options;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

class GmsEmbeddingClientTest {
    private static final String MODEL = "test-embedding";
    private static final String PATH = "/v1/embeddings";
    private static final Duration TIMEOUT = Duration.ofSeconds(2);

    private static WireMockServer server;
    private AiCallRecorder recorder;
    private GmsEmbeddingClient client;

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
        recorder = mock(AiCallRecorder.class);
        GmsProperties gms = new GmsProperties(GmsProperties.Mode.REAL, "test-key", null, null,
                Duration.ofSeconds(1), 0, null, null, null, null,
                Map.of(MODEL, new GmsProperties.Price(new BigDecimal("0.0013"), BigDecimal.ZERO)), null, null, null);
        EmbeddingProperties properties = new EmbeddingProperties(server.baseUrl(), MODEL, 3, 2, TIMEOUT, TIMEOUT);
        client = new GmsEmbeddingClient(properties, gms, JsonMapper.builder().build(), recorder, new SimpleMeterRegistry());
    }

    @Test
    void embedDocuments_배치로_나눠_index_순서대로_돌려주고_요청마다_기록한다() {
        server.stubFor(post(urlPathEqualTo(PATH)).withRequestBody(matchingJsonPath("$.input[0]", equalTo("가")))
                .willReturn(okJson("""
                        {"data":[{"index":1,"embedding":[0,1,0]},{"index":0,"embedding":[1,0,0]}],
                         "usage":{"prompt_tokens":1000,"total_tokens":1000}}""")));
        server.stubFor(post(urlPathEqualTo(PATH)).withRequestBody(matchingJsonPath("$.input[0]", equalTo("다")))
                .willReturn(okJson("""
                        {"data":[{"index":0,"embedding":[0,0,1]}],"usage":{"prompt_tokens":10}}""")));

        List<float[]> vectors = client.embedDocuments(List.of("가", "나", "다"), 7L);

        assertThat(vectors).containsExactly(new float[]{1, 0, 0}, new float[]{0, 1, 0}, new float[]{0, 0, 1});
        server.verify(2, postRequestedFor(urlPathEqualTo(PATH))
                .withHeader("Authorization", equalTo("Bearer test-key"))
                .withRequestBody(matchingJsonPath("$.model", equalTo(MODEL)))
                .withRequestBody(matchingJsonPath("$.dimensions", equalTo("3"))));
        ArgumentCaptor<AiCallLog> logs = ArgumentCaptor.forClass(AiCallLog.class);
        verify(recorder, times(2)).record(logs.capture());
        AiCallLog first = logs.getAllValues().get(0);
        assertThat(first.getPurpose()).isEqualTo(AiCallPurpose.EMBED);
        assertThat(first.getJobId()).isEqualTo(7L);
        assertThat(first.getChatLogId()).isNull();
        assertThat(first.getInputTokens()).isEqualTo(1000);
        assertThat(first.getEstimatedCredits()).isEqualByComparingTo("1.30");
        assertThat(first.getErrorCode()).isNull();
    }

    @Test
    void embedQuery_429면_RATE_LIMIT로_던지고_실패를_기록한다() {
        server.stubFor(post(urlPathEqualTo(PATH)).willReturn(aResponse().withStatus(429)
                .withBody("{\"error\":{\"type\":\"rate_limit_exceeded\"}}")));

        assertThatThrownBy(() -> client.embedQuery("버터 녹이는", 9L))
                .isInstanceOf(LlmException.class)
                .extracting(e -> ((LlmException) e).getKind())
                .isEqualTo(Kind.RATE_LIMIT);
        ArgumentCaptor<AiCallLog> log = ArgumentCaptor.forClass(AiCallLog.class);
        verify(recorder).record(log.capture());
        assertThat(log.getValue().getChatLogId()).isEqualTo(9L);
        assertThat(log.getValue().getInputTokens()).isZero();
        assertThat(log.getValue().getErrorCode()).isEqualTo("RATE_LIMIT");
    }

    @Test
    void 차원이_설정과_다르면_INVALID() {
        server.stubFor(post(urlPathEqualTo(PATH)).willReturn(okJson("""
                {"data":[{"index":0,"embedding":[1,0]}],"usage":{"prompt_tokens":3}}""")));

        assertThatThrownBy(() -> client.embedQuery("버터", 1L))
                .isInstanceOf(LlmException.class)
                .extracting(e -> ((LlmException) e).getKind())
                .isEqualTo(Kind.INVALID);
    }

    @Test
    void 연결이_안_되면_UNAVAILABLE() {
        EmbeddingProperties down = new EmbeddingProperties("http://127.0.0.1:1", MODEL, 3, 2, TIMEOUT, TIMEOUT);
        GmsProperties gms = new GmsProperties(GmsProperties.Mode.REAL, "test-key", null, null,
                Duration.ofSeconds(1), 0, null, null, null, null, Map.of(), null, null, null);
        GmsEmbeddingClient downClient = new GmsEmbeddingClient(down, gms, JsonMapper.builder().build(), recorder,
                new SimpleMeterRegistry());

        assertThatThrownBy(() -> downClient.embedQuery("버터", 1L))
                .isInstanceOf(LlmException.class)
                .extracting(e -> ((LlmException) e).getKind())
                .isEqualTo(Kind.UNAVAILABLE);
    }
}
