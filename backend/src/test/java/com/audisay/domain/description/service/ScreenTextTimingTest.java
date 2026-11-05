package com.audisay.domain.description.service;

import com.audisay.domain.description.service.SceneText.Moment;
import com.audisay.domain.description.service.SceneText.MomentType;
import com.audisay.domain.description.service.ScreenTextTiming.Line;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class ScreenTextTimingTest {

    @Test
    void 화면_글자를_읽은_해설_시각으로_본다() {
        List<Line> lines = List.of(
                new Line(189_000, "별 깍지를 낀 짤주머니에 반죽을 담습니다."),
                new Line(205_000, "칼로 끝부분을 깔끔하게 잘라 가며 형태를 만듭니다."),
                new Line(236_000, "냉동실에서 20분에서 30분 정도 반죽을 굳힙니다."));

        assertThat(ScreenTextTiming.estimate("냉동실에서 약 20~30분 정도 굳혀주세요 Harden in the freezer", 188_000, 242_000,
                lines)).isEqualTo(236_000);
    }

    @Test
    void 읽은_줄이_없거나_장면_밖이면_모른다() {
        List<Line> lines = List.of(new Line(8_000, "Welcome everybody. (모두 환영합니다.)"),
                new Line(300_000, "냉동실에서 20분에서 30분 정도 반죽을 굳힙니다."));

        assertThat(ScreenTextTiming.estimate("ROADSTER", 0, 23_000, lines)).isNull();
        assertThat(ScreenTextTiming.estimate("냉동실에서 약 20~30분 정도 굳혀주세요", 188_000, 242_000, lines)).isNull();
        assertThat(ScreenTextTiming.estimate(null, 0, 23_000, lines)).isNull();
    }

    @Test
    void 장면_찾기용_장면은_화면_글자를_추정_시각으로_옮겨_시간순으로_둔다() {
        Moment screen = new Moment(188_000, MomentType.SCREEN, "냉동실에서 약 20~30분 정도 굳혀주세요");
        Moment first = new Moment(189_000, MomentType.NARRATION, "별 깍지를 낀 짤주머니에 반죽을 담습니다.");
        Moment freezer = new Moment(236_000, MomentType.NARRATION, "냉동실에서 20분에서 30분 정도 반죽을 굳힙니다.");
        Moment title = new Moment(188_000, MomentType.SCREEN, "Chocolate Churros");
        SceneText scene = new SceneText(1L, 1, 188_000, 242_000, "반죽 짜기", "", List.of(), "",
                List.of(screen, title, first, freezer));

        SceneText moved = ScreenTextTiming.retime(scene);

        assertThat(moved.moments()).extracting(Moment::startMs, Moment::text).containsExactly(
                org.assertj.core.groups.Tuple.tuple(188_000, "Chocolate Churros"),
                org.assertj.core.groups.Tuple.tuple(189_000, first.text()),
                org.assertj.core.groups.Tuple.tuple(236_000, screen.text()),
                org.assertj.core.groups.Tuple.tuple(236_000, freezer.text()));
        SceneText untouched = new SceneText(2L, 2, 0, 10_000, "", "", List.of(), "", List.of(title));
        assertThat(ScreenTextTiming.retime(untouched)).isSameAs(untouched);
    }
}
