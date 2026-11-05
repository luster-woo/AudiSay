package com.audisay.global.external.ocr;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class OcrEngineTest {
    private final SimpleMeterRegistry meterRegistry = new SimpleMeterRegistry();

    @Test
    void 앞선_확인이_안_끝나면_파일을_읽기_전에_BUSY() {
        OcrEngine engine = engine(0);

        assertThatThrownBy(() -> engine.read(new byte[]{1, 2, 3}, "image/png"))
                .isInstanceOf(OcrException.class)
                .extracting(e -> ((OcrException) e).kind())
                .isEqualTo(OcrException.Kind.BUSY);
        assertThat(meterRegistry.counter("audisay.ocr.busy").count()).isEqualTo(1);
    }

    @Test
    void 이미지로_못_읽어도_자리를_돌려준다() {
        OcrEngine engine = engine(1);

        for (int i = 0; i < 2; i++) {
            assertThatThrownBy(() -> engine.read(new byte[]{1, 2, 3}, "image/png"))
                    .extracting(e -> ((OcrException) e).kind())
                    .isEqualTo(OcrException.Kind.UNREADABLE_INPUT);
        }
    }

    private OcrEngine engine(int maxConcurrent) {
        OcrProperties properties = new OcrProperties("models/ocr", "det_mobile.onnx", "rec.onnx", "dict.txt", 960, 0.6, 2,
                maxConcurrent, Duration.ofMillis(10), OptimizationLevel.ALL);
        return new OcrEngine(properties, meterRegistry);
    }
}
