package com.audisay.global.external.ocr;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtException;
import ai.onnxruntime.OrtSession;

import java.nio.FloatBuffer;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

/**
 * 글자 위치 찾기(PP-OCRv5 det, DB). 값은 모델의 inference.yml과 같다:
 * BGR, 긴 변 960(resize_long), ImageNet mean·std, thresh 0.3, box_thresh 0.6, unclip_ratio 1.5, 후보 1000개.
 */
final class TextDetector implements AutoCloseable {
    private static final float[] MEAN = {0.485f, 0.456f, 0.406f};
    private static final float[] STD = {0.229f, 0.224f, 0.225f};
    private static final float THRESH = 0.3f;
    private static final double BOX_THRESH = 0.6;
    private static final double UNCLIP_RATIO = 1.5;
    private static final int MAX_CANDIDATES = 1000;
    private static final int SAME_LINE_PX = 10;

    private final OrtEnvironment env;
    private final OrtSession session;
    private final String inputName;
    private final int longSide;

    TextDetector(OrtEnvironment env, OrtSession session, int longSide) {
        this.env = env;
        this.session = session;
        this.inputName = session.getInputNames().iterator().next();
        this.longSide = longSide;
    }

    List<BoxGeometry.Quad> detect(OcrImage image) throws OrtException {
        double r = (double) longSide / Math.max(image.width(), image.height());
        int nh = Math.max((int) Math.round(image.height() * r / 32) * 32, 32);
        int nw = Math.max((int) Math.round(image.width() * r / 32) * 32, 32);
        float[] input = new float[3 * nh * nw];
        image.writeChw(input, 0, nw, nw, nh, MEAN, STD);
        try (OnnxTensor tensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(input), new long[]{1, 3, nh, nw});
             OrtSession.Result result = session.run(Map.of(inputName, tensor))) {
            OnnxTensor out = (OnnxTensor) result.get(0);
            long[] shape = out.getInfo().getShape();
            int ph = (int) shape[2], pw = (int) shape[3];
            float[] pred = new float[ph * pw];
            out.getFloatBuffer().get(pred);
            return boxes(pred, pw, ph, (double) image.width() / pw, (double) image.height() / ph,
                    image.width(), image.height());
        }
    }

    /** 확률 지도 → 글자 상자(원본 좌표), 위에서 아래·같은 줄은 왼쪽부터 */
    static List<BoxGeometry.Quad> boxes(float[] pred, int w, int h, double sx, double sy, int imgW, int imgH) {
        int n = w * h;
        boolean[] seen = new boolean[n];
        int[] queue = new int[n];
        int[] rowMin = new int[h], rowMax = new int[h];
        java.util.Arrays.fill(rowMin, Integer.MAX_VALUE);
        java.util.Arrays.fill(rowMax, -1);
        int[] rows = new int[h];
        int[] px = new int[2 * h], py = new int[2 * h];
        List<BoxGeometry.Quad> found = new ArrayList<>();
        int candidates = 0;
        for (int start = 0; start < n && candidates < MAX_CANDIDATES; start++) {
            if (seen[start] || pred[start] <= THRESH) {
                continue;
            }
            candidates++;
            int head = 0, tail = 0, rowCount = 0;
            queue[tail++] = start;
            seen[start] = true;
            while (head < tail) {
                int cur = queue[head++];
                int cx = cur % w, cy = cur / w;
                if (rowMax[cy] < 0) {
                    rows[rowCount++] = cy;
                }
                rowMin[cy] = Math.min(rowMin[cy], cx);
                rowMax[cy] = Math.max(rowMax[cy], cx);
                for (int dy = -1; dy <= 1; dy++) {
                    int ny = cy + dy;
                    if (ny < 0 || ny >= h) {
                        continue;
                    }
                    for (int dx = -1; dx <= 1; dx++) {
                        int nx = cx + dx;
                        int ni = ny * w + nx;
                        if (nx < 0 || nx >= w || seen[ni] || pred[ni] <= THRESH) {
                            continue;
                        }
                        seen[ni] = true;
                        queue[tail++] = ni;
                    }
                }
            }
            int m = 0;
            for (int k = 0; k < rowCount; k++) {
                int y = rows[k];
                px[m] = rowMin[y];
                py[m++] = y;
                px[m] = rowMax[y];
                py[m++] = y;
                rowMin[y] = Integer.MAX_VALUE;
                rowMax[y] = -1;
            }
            BoxGeometry.Rect rect = BoxGeometry.minAreaRect(px, py, m);
            if (rect.minSide() < 3 || meanInside(pred, w, h, rect.quad()) < BOX_THRESH) {
                continue;
            }
            double d = rect.w() * rect.h() * UNCLIP_RATIO / (2 * (rect.w() + rect.h()));
            BoxGeometry.Rect expanded = rect.expand(d);
            if (expanded.minSide() < 5) {
                continue;
            }
            BoxGeometry.Quad q = expanded.quad();
            double[] xs = new double[4], ys = new double[4];
            for (int k = 0; k < 4; k++) {
                xs[k] = Math.clamp(Math.round(q.xs()[k] * sx), 0, imgW);
                ys[k] = Math.clamp(Math.round(q.ys()[k] * sy), 0, imgH);
            }
            found.add(new BoxGeometry.Quad(xs, ys));
        }
        return sortReadingOrder(found);
    }

    /** PaddleOCR box_score_fast: 상자를 감싸는 칸 안에서 상자 안쪽 화소의 평균 확률 */
    private static double meanInside(float[] pred, int w, int h, BoxGeometry.Quad q) {
        int x0 = clamp((int) Math.floor(min(q.xs())), w), x1 = clamp((int) Math.ceil(max(q.xs())), w);
        int y0 = clamp((int) Math.floor(min(q.ys())), h), y1 = clamp((int) Math.ceil(max(q.ys())), h);
        double sum = 0;
        int count = 0;
        for (int y = y0; y <= y1; y++) {
            for (int x = x0; x <= x1; x++) {
                if (BoxGeometry.inside(q, x, y)) {
                    sum += pred[y * w + x];
                    count++;
                }
            }
        }
        return count == 0 ? 0 : sum / count;
    }

    private static List<BoxGeometry.Quad> sortReadingOrder(List<BoxGeometry.Quad> boxes) {
        List<BoxGeometry.Quad> sorted = new ArrayList<>(boxes);
        sorted.sort(Comparator.<BoxGeometry.Quad>comparingDouble(q -> q.ys()[0]).thenComparingDouble(q -> q.xs()[0]));
        for (int i = 0; i < sorted.size() - 1; i++) {
            for (int j = i; j >= 0; j--) {
                BoxGeometry.Quad a = sorted.get(j), b = sorted.get(j + 1);
                if (Math.abs(b.ys()[0] - a.ys()[0]) < SAME_LINE_PX && b.xs()[0] < a.xs()[0]) {
                    sorted.set(j, b);
                    sorted.set(j + 1, a);
                } else {
                    break;
                }
            }
        }
        return sorted;
    }

    private static int clamp(int v, int size) {
        return Math.clamp(v, 0, size - 1);
    }

    private static double min(double[] v) {
        return Math.min(Math.min(v[0], v[1]), Math.min(v[2], v[3]));
    }

    private static double max(double[] v) {
        return Math.max(Math.max(v[0], v[1]), Math.max(v[2], v[3]));
    }

    @Override
    public void close() throws OrtException {
        session.close();
    }
}
