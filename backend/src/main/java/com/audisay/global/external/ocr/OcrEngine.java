package com.audisay.global.external.ocr;

import ai.onnxruntime.OrtException;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.stereotype.Component;

import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

/**
 * 서버 안에서 도는 OCR(PaddleOCR PP-OCRv5 ONNX). 서류가 서버 밖으로 나가지 않는다.
 * 모델은 처음 쓸 때 불러온다. 읽은 글자는 저장하거나 로그에 남기지 않는다.
 */
@Slf4j
@Component
public class OcrEngine implements DisposableBean {
    private final OcrProperties properties;
    private final MeterRegistry meterRegistry;
    private final Semaphore permits;
    private volatile OcrPipeline pipeline;

    public OcrEngine(OcrProperties properties, MeterRegistry meterRegistry) {
        this.properties = properties;
        this.meterRegistry = meterRegistry;
        this.permits = new Semaphore(properties.maxConcurrent());
    }

    /**
     * 점수가 min-score 이상인 글자 줄(위에서 아래, 같은 줄은 왼쪽부터).
     *
     * @throws OcrException 모델 로드·추론 실패, 대기 시간 초과(ENGINE)
     */
    public List<OcrLine> read(OcrImage image) {
        acquire();
        Timer.Sample sample = Timer.start(meterRegistry);
        String result = "error";
        try {
            List<OcrLine> lines = pipeline().read(image).stream()
                    .filter(line -> line.score() >= properties.minScore())
                    .toList();
            result = "ok";
            return lines;
        } catch (OrtException e) {
            throw new OcrException(OcrException.Kind.ENGINE, "OCR 실행에 실패했습니다.", e);
        } finally {
            sample.stop(meterRegistry.timer("audisay.ocr.read", "result", result));
            permits.release();
        }
    }

    private void acquire() {
        try {
            if (!permits.tryAcquire(properties.waitTimeout().toMillis(), TimeUnit.MILLISECONDS)) {
                meterRegistry.counter("audisay.ocr.busy").increment();
                throw new OcrException(OcrException.Kind.ENGINE, "OCR 대기 시간이 초과되었습니다.");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new OcrException(OcrException.Kind.ENGINE, "OCR 대기 중 중단되었습니다.", e);
        }
    }

    private OcrPipeline pipeline() {
        OcrPipeline current = pipeline;
        if (current != null) {
            return current;
        }
        synchronized (this) {
            if (pipeline == null) {
                long start = System.nanoTime();
                pipeline = OcrPipeline.load(Path.of(properties.modelDir()), properties.detModel(), properties.recModel(),
                        properties.dictionary(), properties.detLongSide(), properties.threads(),
                        properties.optimizationLevel());
                if (!pipeline.failures().isEmpty()) {
                    log.warn("[OCR] 최적화 단계를 낮춤 {} → {}: {}", properties.optimizationLevel(), pipeline.level(),
                            pipeline.failures());
                    meterRegistry.counter("audisay.ocr.level_fallback").increment(pipeline.failures().size());
                }
                log.info("[OCR] 모델 로드 완료 level={} {}ms", pipeline.level(), (System.nanoTime() - start) / 1_000_000);
            }
            return pipeline;
        }
    }

    @Override
    public void destroy() throws OrtException {
        if (pipeline != null) {
            pipeline.close();
        }
    }
}
