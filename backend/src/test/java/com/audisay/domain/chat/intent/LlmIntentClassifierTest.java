package com.audisay.domain.chat.intent;

import com.audisay.domain.chat.entity.ChatIntent;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import com.audisay.global.external.llm.LlmClient;
import com.audisay.global.external.llm.LlmException;
import com.audisay.global.external.llm.LlmPurpose;
import com.audisay.global.external.llm.LlmRequest;
import com.audisay.global.external.llm.LlmResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.mockito.ArgumentCaptor;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class LlmIntentClassifierTest {
    private LlmClient llmClient;
    private LlmIntentClassifier classifier;

    @BeforeEach
    void setUp() {
        llmClient = mock(LlmClient.class);
        classifier = new LlmIntentClassifier(llmClient, JsonMapper.builder().build());
    }

    @Test
    void 발화_분류로_JSON을_요청하고_챗봇_기록에_연결한다() {
        answer("{\"intent\":\"QUESTION\",\"slots\":{}}");

        ClassifiedIntent result = classifier.classify("저 사람 누구야", 31L);

        assertThat(result.intent()).isEqualTo(ChatIntent.QUESTION);
        ArgumentCaptor<LlmRequest> captor = ArgumentCaptor.forClass(LlmRequest.class);
        verify(llmClient).generate(captor.capture());
        LlmRequest request = captor.getValue();
        assertThat(request.purpose()).isEqualTo(LlmPurpose.INTENT);
        assertThat(request.jsonOutput()).isTrue();
        assertThat(request.chatLogId()).isEqualTo(31L);
        assertThat(request.user()).isEqualTo("말: 저 사람 누구야");
    }

    @ParameterizedTest(name = "{0} → {1}")
    @CsvSource(delimiter = '|', textBlock = """
            {"intent":"SEEK_TIME","slots":{"targetMs":90000}}                         | SEEK_TIME target=90000
            {"intent":"SEEK_TIME","slots":{"relativeMs":-30000}}                      | SEEK_TIME rel=-30000
            {"intent":"SEEK_TIME","slots":{"toEnd":true}}                             | SEEK_TIME END
            {"intent":"SEEK_TIME","slots":{}}                                         | SEEK_SCENE q=원래 말
            {"intent":"SEEK_SCENE","slots":{"query":"로켓 달린 차 점프"}}               | SEEK_SCENE q=로켓 달린 차 점프
            {"intent":"SEEK_SCENE","slots":{}}                                        | SEEK_SCENE q=원래 말
            {"intent":"SETTING","slots":{"settingKey":"speechRate","settingValue":"1.5"}} | SETTING speechRate=1.5
            {"intent":"SETTING","slots":{"settingKey":"speechRate","settingValue":3}}  | SETTING speechRate=2.5
            {"intent":"SETTING","slots":{"settingKey":"detailLevel","settingValue":3}} | SETTING detailLevel=3
            {"intent":"SETTING","slots":{"settingKey":"speechRate","direction":"DOWN"}} | SETTING speechRate DOWN
            {"intent":"SETTING","slots":{"settingKey":"narrationMode","settingValue":"pause_after"}} | SETTING narrationMode=PAUSE_AFTER
            {"intent":"SETTING","slots":{"settingKey":"highContrast","settingValue":true}} | SETTING highContrast=true
            {"intent":"SETTING","slots":{"settingKey":"seekStepSec","settingValue":"10"}} | SETTING seekStepSec=10
            {"intent":"SETTING","slots":{"settingKey":"seekStepSec","settingValue":"15"}} | UNKNOWN
            {"intent":"SETTING","slots":{"settingKey":"soundMix","direction":"UP"}}    | UNKNOWN
            {"intent":"SETTING","slots":{"settingKey":"voice","settingValue":"F1"}}    | UNKNOWN
            {"intent":"ACTION","slots":{"actionCode":"REPEAT_LAST"}}                  | ACTION REPEAT_LAST
            {"intent":"ACTION","slots":{"actionCode":"REPORT"}}                       | UNKNOWN
            {"intent":"SEARCH_VIDEO","slots":{"query":"치즈케이크 만드는"}}             | SEARCH_VIDEO q=치즈케이크 만드는
            {"intent":"SEARCH_VIDEO","slots":{}}                                      | UNKNOWN
            {"intent":"WEATHER","slots":{}}                                           | UNKNOWN
            ```json {"intent":"SCENE_NOW","slots":{}} ```                             | SCENE_NOW
            분류할 수 없어요                                                            | UNKNOWN
            {"intent":                                                                | UNKNOWN
            """)
    void LLM_응답을_분류_결과로_바꾼다(String response, String expected) {
        answer(response);

        assertThat(format(classifier.classify("원래 말", 1L))).isEqualTo(expected);
    }

    @Test
    void 안전_정책_거부는_UNKNOWN() {
        when(llmClient.generate(any())).thenThrow(new LlmException(LlmException.Kind.BLOCKED, 200, "blocked", null));

        assertThat(classifier.classify("말", 1L).intent()).isEqualTo(ChatIntent.UNKNOWN);
    }

    @Test
    void 한도_초과는_CHAT_007() {
        when(llmClient.generate(any())).thenThrow(new LlmException(LlmException.Kind.RATE_LIMIT, 429, "limit", null));

        assertThatThrownBy(() -> classifier.classify("말", 1L))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode").isEqualTo(ErrorCode.CHAT_AI_LIMIT);
    }

    @Test
    void 장애는_CHAT_005_시간_초과는_CHAT_006() {
        when(llmClient.generate(any()))
                .thenThrow(new LlmException(LlmException.Kind.UNAVAILABLE, 503, "down", null))
                .thenThrow(new LlmException(LlmException.Kind.TIMEOUT, 0, "slow", null));

        assertThatThrownBy(() -> classifier.classify("말", 1L))
                .extracting("errorCode").isEqualTo(ErrorCode.CHAT_AI_UNAVAILABLE);
        assertThatThrownBy(() -> classifier.classify("말", 1L))
                .extracting("errorCode").isEqualTo(ErrorCode.CHAT_AI_TIMEOUT);
    }

    private void answer(String text) {
        when(llmClient.generate(any())).thenReturn(new LlmResult(text, "gemini-3.1-flash-lite", 10, 5, 800, false, 7L));
    }

    private static String format(ClassifiedIntent x) {
        StringBuilder b = new StringBuilder(x.intent().name());
        if (x.targetMs() != null) {
            b.append(" target=").append(x.targetMs());
        }
        if (x.relativeMs() != null) {
            b.append(" rel=").append(x.relativeMs());
        }
        if (x.toEnd()) {
            b.append(" END");
        }
        if (x.query() != null) {
            b.append(" q=").append(x.query());
        }
        if (x.settingKey() != null) {
            b.append(" ").append(x.settingKey());
            if (x.settingValue() != null) {
                b.append("=").append(x.settingValue());
            }
            if (x.direction() != null) {
                b.append(" ").append(x.direction());
            }
        }
        if (x.actionCode() != null) {
            b.append(" ").append(x.actionCode());
        }
        return b.toString();
    }
}
