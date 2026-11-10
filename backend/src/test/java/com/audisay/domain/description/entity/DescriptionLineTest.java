package com.audisay.domain.description.entity;

import org.junit.jupiter.api.Test;
import org.springframework.beans.BeanUtils;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;

class DescriptionLineTest {

    @Test
    void 중요도만_바꾸면_음성을_그대로_둔다() {
        DescriptionLine line = line("칠판이 보여요.");

        boolean changed = line.edit("칠판이 보여요.", (short) 3);

        assertThat(changed).isFalse();
        assertThat(line.getImportance()).isEqualTo((short) 3);
        assertThat(line.getAudioKey()).isEqualTo("tts/1.mp3");
        assertThat(line.getAudioDurationMs()).isEqualTo(1200);
    }

    @Test
    void 글자를_바꾸면_음성을_비운다() {
        DescriptionLine line = line("칠판이 보여요.");

        boolean changed = line.edit("초록 칠판이 보여요.", null);

        assertThat(changed).isTrue();
        assertThat(line.getText()).isEqualTo("초록 칠판이 보여요.");
        assertThat(line.getImportance()).isEqualTo((short) 2);
        assertThat(line.getAudioKey()).isNull();
        assertThat(line.getAudioDurationMs()).isNull();
    }

    private static DescriptionLine line(String text) {
        DescriptionLine line = BeanUtils.instantiateClass(DescriptionLine.class);
        ReflectionTestUtils.setField(line, "text", text);
        ReflectionTestUtils.setField(line, "importance", (short) 2);
        ReflectionTestUtils.setField(line, "audioKey", "tts/1.mp3");
        ReflectionTestUtils.setField(line, "audioDurationMs", 1200);
        return line;
    }
}
