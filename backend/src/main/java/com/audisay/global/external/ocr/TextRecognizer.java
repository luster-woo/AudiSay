package com.audisay.global.external.ocr;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtException;
import ai.onnxruntime.OrtSession;

import java.nio.FloatBuffer;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

/**
 * 글자 읽기(korean PP-OCRv5 mobile rec, CTC). 높이 48, 너비는 묶음에서 가장 긴 비율(최소 320/48)에 맞추고 오른쪽은 0으로 채운다.
 */
final class TextRecognizer implements AutoCloseable {
    static final int HEIGHT = 48;
    private static final double MIN_RATIO = 320.0 / 48;
    private static final int BATCH = 6;
    private static final float[] HALF = {0.5f, 0.5f, 0.5f};

    private final OrtEnvironment env;
    private final OrtSession session;
    private final String inputName;
    /** 0번은 CTC 빈칸, 마지막은 띄어쓰기 */
    private final String[] chars;

    TextRecognizer(OrtEnvironment env, OrtSession session, String[] chars) {
        this.env = env;
        this.session = session;
        this.inputName = session.getInputNames().iterator().next();
        this.chars = chars;
    }

    List<OcrLine> recognize(List<OcrImage> crops) throws OrtException {
        OcrLine[] lines = new OcrLine[crops.size()];
        Integer[] order = new Integer[crops.size()];
        Arrays.setAll(order, i -> i);
        Arrays.sort(order, Comparator.comparingDouble(i -> ratio(crops.get(i))));
        for (int k = 0; k < order.length; k += BATCH) {
            Integer[] idx = Arrays.copyOfRange(order, k, Math.min(order.length, k + BATCH));
            double maxRatio = MIN_RATIO;
            for (int i : idx) {
                maxRatio = Math.max(maxRatio, ratio(crops.get(i)));
            }
            int width = (int) (HEIGHT * maxRatio);
            int one = 3 * HEIGHT * width;
            float[] input = new float[idx.length * one];
            for (int j = 0; j < idx.length; j++) {
                OcrImage c = crops.get(idx[j]);
                int rw = Math.min(width, (int) Math.ceil(HEIGHT * ratio(c)));
                c.writeChw(input, j * one, width, rw, HEIGHT, HALF, HALF);
            }
            try (OnnxTensor tensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(input),
                    new long[]{idx.length, 3, HEIGHT, width});
                 OrtSession.Result result = session.run(Map.of(inputName, tensor))) {
                OnnxTensor out = (OnnxTensor) result.get(0);
                long[] shape = out.getInfo().getShape();
                int steps = (int) shape[1], classes = (int) shape[2];
                float[] probs = new float[idx.length * steps * classes];
                out.getFloatBuffer().get(probs);
                for (int j = 0; j < idx.length; j++) {
                    lines[idx[j]] = decode(probs, j * steps * classes, steps, classes, chars);
                }
            }
        }
        return Arrays.asList(lines);
    }

    /** CTC 탐욕 복원: 칸마다 가장 높은 글자, 연속 중복과 빈칸(0)은 뺀다. 점수는 남긴 글자 확률의 평균 */
    static OcrLine decode(float[] probs, int offset, int steps, int classes, String[] chars) {
        StringBuilder text = new StringBuilder();
        double sum = 0;
        int kept = 0;
        int prev = -1;
        for (int t = 0; t < steps; t++) {
            int base = offset + t * classes;
            int best = 0;
            for (int c = 1; c < classes; c++) {
                if (probs[base + c] > probs[base + best]) {
                    best = c;
                }
            }
            if (best != 0 && best != prev && best < chars.length) {
                text.append(chars[best]);
                sum += probs[base + best];
                kept++;
            }
            prev = best;
        }
        return new OcrLine(text.toString(), kept == 0 ? 0 : sum / kept);
    }

    private static double ratio(OcrImage c) {
        return (double) c.width() / c.height();
    }

    @Override
    public void close() throws OrtException {
        session.close();
    }
}
