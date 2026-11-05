package com.audisay.global.external.ocr;

import java.util.Arrays;

/** 글자 상자 계산(OpenCV minAreaRect·boxPoints와 PaddleOCR get_mini_boxes를 OpenCV 없이) */
final class BoxGeometry {

    private BoxGeometry() {
    }

    /** 꼭짓점 네 개: 왼쪽 위, 오른쪽 위, 오른쪽 아래, 왼쪽 아래 */
    record Quad(double[] xs, double[] ys) {
    }

    /** 회전된 직사각형. (ux, uy)는 w 방향 단위 벡터 */
    record Rect(double cx, double cy, double w, double h, double ux, double uy) {

        double minSide() {
            return Math.min(w, h);
        }

        Rect expand(double d) {
            return new Rect(cx, cy, w + 2 * d, h + 2 * d, ux, uy);
        }

        Quad quad() {
            double vx = -uy, vy = ux;
            double[][] p = new double[4][];
            int k = 0;
            for (int su : new int[]{-1, 1}) {
                for (int sv : new int[]{-1, 1}) {
                    p[k++] = new double[]{cx + su * ux * w / 2 + sv * vx * h / 2, cy + su * uy * w / 2 + sv * vy * h / 2};
                }
            }
            Arrays.sort(p, (a, b) -> Double.compare(a[0], b[0]));
            double[] tl = p[0][1] < p[1][1] ? p[0] : p[1], bl = p[0][1] < p[1][1] ? p[1] : p[0];
            double[] tr = p[2][1] < p[3][1] ? p[2] : p[3], br = p[2][1] < p[3][1] ? p[3] : p[2];
            return new Quad(new double[]{tl[0], tr[0], br[0], bl[0]}, new double[]{tl[1], tr[1], br[1], bl[1]});
        }
    }

    /** 점들을 감싸는 넓이가 가장 작은 직사각형(볼록 껍질 + 회전 캘리퍼스) */
    static Rect minAreaRect(int[] xs, int[] ys, int n) {
        int[][] hull = convexHull(xs, ys, n);
        if (hull.length == 1) {
            return new Rect(hull[0][0], hull[0][1], 0, 0, 1, 0);
        }
        Rect best = null;
        double bestArea = Double.MAX_VALUE;
        for (int i = 0; i < hull.length; i++) {
            int[] a = hull[i], b = hull[(i + 1) % hull.length];
            double len = Math.hypot(b[0] - a[0], b[1] - a[1]);
            if (len == 0) {
                continue;
            }
            double ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
            double minU = Double.MAX_VALUE, maxU = -Double.MAX_VALUE, minV = Double.MAX_VALUE, maxV = -Double.MAX_VALUE;
            for (int[] p : hull) {
                double u = p[0] * ux + p[1] * uy, v = -p[0] * uy + p[1] * ux;
                minU = Math.min(minU, u);
                maxU = Math.max(maxU, u);
                minV = Math.min(minV, v);
                maxV = Math.max(maxV, v);
            }
            double area = (maxU - minU) * (maxV - minV);
            if (area < bestArea) {
                bestArea = area;
                double mu = (minU + maxU) / 2, mv = (minV + maxV) / 2;
                best = new Rect(mu * ux - mv * uy, mu * uy + mv * ux, maxU - minU, maxV - minV, ux, uy);
            }
        }
        return best;
    }

    /** 앤드루 단조 사슬. 같은 점은 하나로 */
    static int[][] convexHull(int[] xs, int[] ys, int n) {
        long[] keys = new long[n];
        for (int i = 0; i < n; i++) {
            keys[i] = ((long) xs[i] << 32) | (ys[i] & 0xFFFFFFFFL);
        }
        Arrays.sort(keys);
        int m = 0;
        for (int i = 0; i < n; i++) {
            if (m == 0 || keys[i] != keys[m - 1]) {
                keys[m++] = keys[i];
            }
        }
        int[][] pts = new int[m][];
        for (int i = 0; i < m; i++) {
            pts[i] = new int[]{(int) (keys[i] >> 32), (int) keys[i]};
        }
        if (m < 3) {
            return pts;
        }
        int[][] hull = new int[2 * m][];
        int k = 0;
        for (int i = 0; i < m; i++) {
            while (k >= 2 && cross(hull[k - 2], hull[k - 1], pts[i]) <= 0) {
                k--;
            }
            hull[k++] = pts[i];
        }
        for (int i = m - 2, lower = k + 1; i >= 0; i--) {
            while (k >= lower && cross(hull[k - 2], hull[k - 1], pts[i]) <= 0) {
                k--;
            }
            hull[k++] = pts[i];
        }
        return Arrays.copyOf(hull, k - 1);
    }

    private static long cross(int[] o, int[] a, int[] b) {
        return (long) (a[0] - o[0]) * (b[1] - o[1]) - (long) (a[1] - o[1]) * (b[0] - o[0]);
    }

    /** 볼록 사각형 안(경계 포함)이면 true */
    static boolean inside(Quad q, double x, double y) {
        double[] xs = q.xs(), ys = q.ys();
        boolean pos = false, neg = false;
        for (int i = 0; i < 4; i++) {
            int j = (i + 1) % 4;
            double c = (xs[j] - xs[i]) * (y - ys[i]) - (ys[j] - ys[i]) * (x - xs[i]);
            pos |= c > 1e-9;
            neg |= c < -1e-9;
        }
        return !(pos && neg);
    }
}
