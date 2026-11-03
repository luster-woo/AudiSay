package com.audisay.global.external.llm.mock;

import com.audisay.global.external.llm.LlmException;
import com.audisay.global.external.llm.LlmException.Kind;
import com.audisay.global.external.llm.LlmPurpose;
import com.audisay.global.external.llm.LlmRequest;
import com.audisay.global.external.llm.LlmResult;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class FakeLlmProviderTest {

    @Test
    void 용도별_가짜_응답을_주고_답변은_조각으로_흘린다() {
        FakeLlmProvider provider = new FakeLlmProvider("mock", Duration.ZERO, null);
        List<String> deltas = new ArrayList<>();

        LlmResult intent = provider.generate(LlmRequest.json(LlmPurpose.INTENT, "s", "u", 200), "m");
        LlmResult answer = provider.stream(LlmRequest.text(LlmPurpose.ANSWER, "s", "u", 300), "m", deltas::add);

        assertThat(intent.text()).isEqualTo(FakeLlmProvider.INTENT_JSON);
        assertThat(intent.model()).isEqualTo("mock");
        assertThat(String.join("", deltas)).isEqualTo(FakeLlmProvider.ANSWER);
        assertThat(deltas).hasSizeGreaterThan(1);
        assertThat(answer.text()).isEqualTo(FakeLlmProvider.ANSWER);
    }

    @Test
    void 설정한_장애를_낸다() {
        FakeLlmProvider provider = new FakeLlmProvider("mock", Duration.ZERO, Kind.RATE_LIMIT);

        assertThatThrownBy(() -> provider.generate(LlmRequest.json(LlmPurpose.SEEK, "s", "u", 100), "m"))
                .isInstanceOf(LlmException.class)
                .extracting(e -> ((LlmException) e).getKind())
                .isEqualTo(Kind.RATE_LIMIT);
    }
}
