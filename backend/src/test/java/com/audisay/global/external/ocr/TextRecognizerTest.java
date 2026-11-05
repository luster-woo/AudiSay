package com.audisay.global.external.ocr;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.data.Offset.offset;

class TextRecognizerTest {
    private static final String[] CHARS = {"", "시", "각", " "};

    @Test
    void 연속_중복과_빈칸을_빼고_읽는다() {
        // 칸: 시 시 빈칸 각 각 → "시각"
        float[] probs = {
                0.1f, 0.9f, 0.0f, 0.0f,
                0.2f, 0.8f, 0.0f, 0.0f,
                0.9f, 0.1f, 0.0f, 0.0f,
                0.0f, 0.0f, 1.0f, 0.0f,
                0.3f, 0.0f, 0.7f, 0.0f
        };
        OcrLine line = TextRecognizer.decode(probs, 0, 5, 4, CHARS);

        assertThat(line.text()).isEqualTo("시각");
        assertThat(line.score()).isCloseTo((0.9 + 1.0) / 2, offset(1e-6));
    }

    @Test
    void 빈칸으로_나뉜_같은_글자는_두_번_읽는다() {
        float[] probs = {
                0.0f, 1.0f, 0.0f, 0.0f,
                1.0f, 0.0f, 0.0f, 0.0f,
                0.0f, 1.0f, 0.0f, 0.0f
        };
        assertThat(TextRecognizer.decode(probs, 0, 3, 4, CHARS).text()).isEqualTo("시시");
    }

    @Test
    void 글자가_없으면_빈_줄_점수_0() {
        float[] probs = {1.0f, 0.0f, 0.0f, 0.0f};
        OcrLine line = TextRecognizer.decode(probs, 0, 1, 4, CHARS);

        assertThat(line.text()).isEmpty();
        assertThat(line.score()).isZero();
    }
}
