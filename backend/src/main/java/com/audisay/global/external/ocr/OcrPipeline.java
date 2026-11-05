package com.audisay.global.external.ocr;

import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtException;
import ai.onnxruntime.OrtSession;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/**
 * 글자 위치 찾기 → 상자마다 펴서 자르기 → 글자 읽기. Spring 없이 쓸 수 있다(평가 도구에서도 같은 코드).
 * 세션은 여러 스레드가 함께 써도 된다(ONNX Runtime OrtSession.run은 스레드 안전).
 */
public final class OcrPipeline implements AutoCloseable {
    private final TextDetector detector;
    private final TextRecognizer recognizer;
    private final OptimizationLevel level;
    private final List<String> failures;

    private OcrPipeline(TextDetector detector, TextRecognizer recognizer, OptimizationLevel level, List<String> failures) {
        this.detector = detector;
        this.recognizer = recognizer;
        this.level = level;
        this.failures = failures;
    }

    /**
     * start 단계부터 모델을 불러오고 시험 추론을 한 번 해 본다. 실패하면 다음(낮은) 최적화 단계로 다시 시도한다.
     *
     * @throws OcrException 모든 단계에서 실패하면(ENGINE)
     */
    public static OcrPipeline load(Path dir, String detModel, String recModel, String dictionary,
                                   int detLongSide, int threads, OptimizationLevel start) {
        OrtEnvironment env = OrtEnvironment.getEnvironment();
        String[] chars = readDictionary(dir.resolve(dictionary));
        List<String> failures = new ArrayList<>();
        for (OptimizationLevel level : start.fromHere()) {
            TextDetector det = null;
            TextRecognizer rec = null;
            try {
                det = new TextDetector(env, session(env, dir.resolve(detModel), level, threads), detLongSide);
                rec = new TextRecognizer(env, session(env, dir.resolve(recModel), level, threads), chars);
                OcrPipeline pipeline = new OcrPipeline(det, rec, level, List.copyOf(failures));
                pipeline.warmUp();
                return pipeline;
            } catch (OrtException | RuntimeException e) {
                failures.add(level + ": " + e.getMessage());
                closeQuietly(det);
                closeQuietly(rec);
            }
        }
        throw new OcrException(OcrException.Kind.ENGINE, "OCR 모델을 불러오지 못했습니다: " + failures);
    }

    public List<OcrLine> read(OcrImage image) throws OrtException {
        List<OcrImage> crops = detector.detect(image).stream().map(image::crop).filter(Objects::nonNull).toList();
        return crops.isEmpty() ? List.of() : recognizer.recognize(crops);
    }

    /** 실제로 쓰는 최적화 단계 */
    public OptimizationLevel level() {
        return level;
    }

    /** 내려오기 전에 실패한 단계와 이유 */
    public List<String> failures() {
        return failures;
    }

    private void warmUp() throws OrtException {
        int w = 128, h = 64;
        int[] px = new int[w * h];
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                px[y * w + x] = (y > 24 && y < 40 && x > 16 && x < 112) ? 0 : 0xFFFFFF;
            }
        }
        OcrImage image = new OcrImage(w, h, px);
        detector.detect(image);
        recognizer.recognize(List.of(image.resize(96, TextRecognizer.HEIGHT)));
    }

    private static OrtSession session(OrtEnvironment env, Path model, OptimizationLevel level, int threads)
            throws OrtException {
        try (OrtSession.SessionOptions options = new OrtSession.SessionOptions()) {
            options.setOptimizationLevel(level.ortLevel());
            options.setIntraOpNumThreads(threads);
            options.setInterOpNumThreads(1);
            // 아레나·메모리 패턴을 끄면 평가 프로세스 최대 RSS가 약 600MB → 410MB(힙 128MB, 견본 24장, 속도 차이 없음)
            options.setCPUArenaAllocator(false);
            options.setMemoryPatternOptimization(false);
            return env.createSession(model.toString(), options);
        }
    }

    private static String[] readDictionary(Path path) {
        try {
            List<String> lines = Files.readAllLines(path, StandardCharsets.UTF_8);
            String[] chars = new String[lines.size() + 2];
            chars[0] = "";
            for (int i = 0; i < lines.size(); i++) {
                chars[i + 1] = lines.get(i).replace("\r", "");
            }
            chars[chars.length - 1] = " ";
            return chars;
        } catch (IOException e) {
            throw new OcrException(OcrException.Kind.ENGINE, "OCR 글자 사전을 읽지 못했습니다: " + path,
                    new UncheckedIOException(e));
        }
    }

    private static void closeQuietly(AutoCloseable c) {
        if (c == null) {
            return;
        }
        try {
            c.close();
        } catch (Exception ignored) {
            // 이미 실패한 단계 정리
        }
    }

    @Override
    public void close() throws OrtException {
        detector.close();
        recognizer.close();
    }
}
