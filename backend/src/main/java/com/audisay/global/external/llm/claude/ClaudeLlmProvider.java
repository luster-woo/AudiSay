package com.audisay.global.external.llm.claude;

import com.audisay.global.external.llm.AbstractHttpLlmProvider;
import com.audisay.global.external.llm.DeltaHandler;
import com.audisay.global.external.llm.GmsProperties;
import com.audisay.global.external.llm.LlmException;
import com.audisay.global.external.llm.LlmException.Kind;
import com.audisay.global.external.llm.LlmRequest;
import com.audisay.global.external.llm.LlmResult;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 대체 모델. Gemini가 429·장애일 때 GMS를 거쳐 Anthropic Messages API(claude-haiku-5-5)를 부른다.
 * JSON 응답 모드가 없어 프롬프트로 JSON을 받고, 코드 블록(```json)으로 감싸 오면 벗긴다.
 */
@Slf4j
@Component("fallbackLlmProvider")
@ConditionalOnProperty(prefix = "audisay.gms", name = "mode", havingValue = "real", matchIfMissing = true)
public class ClaudeLlmProvider extends AbstractHttpLlmProvider {
    private static final String KEY_HEADER = "x-api-key";
    private static final String VERSION_HEADER = "anthropic-version";
    private static final String VERSION = "2023-06-01";
    private static final String URI = "/v1/messages";
    private static final String REFUSAL = "refusal";
    private static final String MAX_TOKENS = "max_tokens";
    private static final Pattern CODE_BLOCK = Pattern.compile("^```(?:json)?\\s*(.*?)\\s*```$", Pattern.DOTALL);

    public ClaudeLlmProvider(GmsProperties properties, ObjectMapper objectMapper) {
        super("claude", properties.anthropicBaseUrl(), properties, objectMapper);
    }

    @Override
    public LlmResult generate(LlmRequest request, String model) {
        long start = System.nanoTime();
        String response = post(request.purpose(), URI, this::auth, toJson(ClaudeRequest.of(request, model, false)));
        ClaudeResponse parsed = parse(response, ClaudeResponse.class);
        if (REFUSAL.equals(parsed.stopReason())) {
            throw new LlmException(Kind.BLOCKED, 200, "안전 정책으로 거부됨: refusal", null);
        }
        String text = request.jsonOutput() ? unwrapCodeBlock(parsed.text()) : parsed.text();
        ClaudeResponse.Usage usage = parsed.usage() == null ? new ClaudeResponse.Usage(0, 0) : parsed.usage();
        return new LlmResult(text, model, usage.input(), usage.output(), elapsedMs(start), false, null);
    }

    @Override
    public LlmResult stream(LlmRequest request, String model, DeltaHandler handler) {
        long start = System.nanoTime();
        StringBuilder text = new StringBuilder();
        int[] usage = new int[2];
        boolean[] stopped = {false};
        boolean cancelled = postSse(request.purpose(), URI, this::auth, toJson(ClaudeRequest.of(request, model, true)),
                (data, control) -> {
                    ClaudeEvent event = parse(data, ClaudeEvent.class);
                    String type = event.type() == null ? "" : event.type();
                    switch (type) {
                        case "message_start" -> {
                            if (event.message() != null && event.message().usage() != null) {
                                usage[0] = event.message().usage().input();
                            }
                        }
                        case "content_block_delta" -> {
                            String delta = event.delta() == null ? null : event.delta().text();
                            if (delta != null && !delta.isEmpty()) {
                                control.textArrived();
                                text.append(delta);
                                return handler.onDelta(delta);
                            }
                        }
                        case "message_delta" -> {
                            if (event.usage() != null) {
                                usage[1] = event.usage().output();
                            }
                            if (event.delta() != null && REFUSAL.equals(event.delta().stopReason())) {
                                throw new LlmException(Kind.BLOCKED, 200, "안전 정책으로 거부됨: refusal", null);
                            }
                            if (event.delta() != null && MAX_TOKENS.equals(event.delta().stopReason())) {
                                log.warn("[LLM] claude 답이 출력 한도({}토큰)에서 잘림 purpose={}",
                                        request.maxOutputTokens(), request.purpose());
                            }
                        }
                        case "message_stop" -> {
                            stopped[0] = true;
                            control.finished();
                        }
                        case "error" -> throw streamError(event.error());
                        default -> {
                        }
                    }
                    return true;
                });
        if (!cancelled && !stopped[0]) {
            // message_stop 없이 연결이 닫히면 잘린 답을 성공으로 받지 않는다
            throw new LlmException(Kind.UNAVAILABLE, 0, "claude 스트리밍이 끝 신호 없이 끊겼습니다", null);
        }
        return new LlmResult(text.toString(), model, usage[0], usage[1], elapsedMs(start), cancelled, null);
    }

    private void auth(HttpHeaders headers) {
        headers.set(KEY_HEADER, apiKey());
        headers.set(VERSION_HEADER, VERSION);
    }

    /** 스트림 도중 온 error 이벤트(HTTP는 이미 200) */
    private static LlmException streamError(ClaudeEvent.ErrorBody error) {
        String type = error == null || error.type() == null ? "" : error.type();
        Kind kind = switch (type) {
            case "rate_limit_error" -> Kind.RATE_LIMIT;
            case "overloaded_error", "api_error" -> Kind.UNAVAILABLE;
            default -> Kind.INVALID;
        };
        return new LlmException(kind, 200, "claude 스트리밍 오류: " + type, null);
    }

    static String unwrapCodeBlock(String text) {
        String trimmed = text.trim();
        Matcher matcher = CODE_BLOCK.matcher(trimmed);
        return matcher.matches() ? matcher.group(1) : trimmed;
    }
}
