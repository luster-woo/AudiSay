package com.audisay.domain.chat.answer;

import com.audisay.domain.description.service.AnswerContext;
import com.audisay.domain.description.service.AnswerContext.SceneInfo;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class SceneNowComposerTest {

    @Test
    void 첫_문장은_지금_장면_제목() {
        assertThat(SceneNowComposer.title(context(scene("투수가 공을 던집니다.")))).isEqualTo("지금은 2회 초 장면이에요.");
        assertThat(SceneNowComposer.title(empty())).isNull();
    }

    @Test
    void LLM을_못_쓰면_장면_설명_앞_2문장() {
        assertThat(SceneNowComposer.fallback(context(scene("투수가 공을 던집니다. 타자가 기다립니다. 관중이 외칩니다."))))
                .containsExactly("투수가 공을 던집니다.", "타자가 기다립니다.");
    }

    @Test
    void 장면이나_설명이_없으면_안내() {
        assertThat(SceneNowComposer.fallback(context(scene(" ")))).containsExactly(SceneNowComposer.NO_SCENE);
        assertThat(SceneNowComposer.fallback(empty())).containsExactly(SceneNowComposer.NO_SCENE);
    }

    private static SceneInfo scene(String description) {
        return new SceneInfo(180_000, "2회 초", description, List.of(), List.of());
    }

    private static AnswerContext context(SceneInfo scene) {
        return new AnswerContext("두산 대 LG", null, 200_000, List.of(scene), List.of(), List.of());
    }

    private static AnswerContext empty() {
        return new AnswerContext("두산 대 LG", null, 0, List.of(), List.of(), List.of());
    }
}
