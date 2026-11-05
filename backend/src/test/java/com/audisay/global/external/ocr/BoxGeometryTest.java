package com.audisay.global.external.ocr;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.data.Offset.offset;

class BoxGeometryTest {

    @Test
    void 기울어진_직사각형의_최소_상자() {
        // 가로 100 세로 20 직사각형을 30도 돌린 점들
        double a = Math.toRadians(30);
        int n = 0;
        int[] xs = new int[2121], ys = new int[2121];
        for (int u = 0; u <= 100; u++) {
            for (int v = 0; v <= 20; v++) {
                xs[n] = (int) Math.round(200 + u * Math.cos(a) - v * Math.sin(a));
                ys[n++] = (int) Math.round(100 + u * Math.sin(a) + v * Math.cos(a));
            }
        }
        BoxGeometry.Rect rect = BoxGeometry.minAreaRect(xs, ys, n);

        assertThat(Math.max(rect.w(), rect.h())).isCloseTo(100, offset(2.0));
        assertThat(rect.minSide()).isCloseTo(20, offset(2.0));
    }

    @Test
    void 꼭짓점은_왼쪽위_오른쪽위_오른쪽아래_왼쪽아래() {
        BoxGeometry.Quad q = new BoxGeometry.Rect(50, 20, 80, 20, 1, 0).quad();

        assertThat(q.xs()).containsExactly(10, 90, 90, 10);
        assertThat(q.ys()).containsExactly(10, 10, 30, 30);
    }

    @Test
    void 키우면_네_변이_d씩_늘어난다() {
        BoxGeometry.Rect rect = new BoxGeometry.Rect(50, 20, 80, 20, 1, 0).expand(6);

        assertThat(rect.w()).isEqualTo(92);
        assertThat(rect.h()).isEqualTo(32);
    }

    @Test
    void 사각형_안쪽과_경계는_안이다() {
        BoxGeometry.Quad q = new BoxGeometry.Rect(50, 20, 80, 20, 1, 0).quad();

        assertThat(BoxGeometry.inside(q, 50, 20)).isTrue();
        assertThat(BoxGeometry.inside(q, 10, 10)).isTrue();
        assertThat(BoxGeometry.inside(q, 95, 20)).isFalse();
    }
}
