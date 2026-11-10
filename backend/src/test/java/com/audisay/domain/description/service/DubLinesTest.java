package com.audisay.domain.description.service;

import com.audisay.domain.description.entity.DescriptionLine;
import com.audisay.domain.description.entity.TranscriptSegment;
import com.audisay.domain.description.service.DubLines.Spoken;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class DubLinesTest {
    // AI describe.dub_lines 테스트(ai/tests/test_pipeline.py)와 같은 모양: 번역은 대사 글이고, 해설 줄은 문장별로 나뉘며 이름이 붙는다
    private static final String TOAST = "총독 각하의 건배사입니다. 조선 최초의 기송관이 성공적으로 개통되었습니다. "
            + "이는 조선 근대화의 새로운 이정표이며 만선 번영의 첫걸음이 될 것입니다.";
    private static final List<Spoken> DIALOGUES = List.of(
            new Spoken(5_000, 9_000, "오늘은 라면을 끓여 볼게요."),
            new Spoken(20_000, 24_000, "금일 5월 15일."),
            new Spoken(30_000, 50_000, TOAST),
            new Spoken(50_000, 52_000, "이상입니다."));

    @Test
    void 대사_번역을_읽어_주는_문장은_가른다() {
        assertThat(DubLines.isDub(20_000, 1, "총독: 금일 5월 15일.", DIALOGUES)).isTrue();
        assertThat(DubLines.isDub(30_000, 1, "태웅: 총독 각하의 건배사입니다. 조선 최초의 기송관이 성공적으로 개통되었습니다.",
                DIALOGUES)).isTrue();
        // 대사 중간에서 나뉜 뒤 문장(이름 없음), 앞 문장을 읽느라 대사 끝 뒤로 밀린 문장
        assertThat(DubLines.isDub(40_123, 1, "이는 조선 근대화의 새로운 이정표이며 만선 번영의 첫걸음이 될 것입니다.", DIALOGUES)).isTrue();
        assertThat(DubLines.isDub(53_000, 1, "이상입니다.", DIALOGUES)).isTrue();
    }

    @Test
    void 화면_해설은_남긴다() {
        assertThat(DubLines.isDub(19_500, 1, "총독이 단상에 선다.", DIALOGUES)).isFalse();
        // 같은 글이라도 대사보다 앞이거나 대사가 끝나고 한참 뒤면 해설로 본다
        assertThat(DubLines.isDub(10_000, 1, "금일 5월 15일.", DIALOGUES)).isFalse();
        assertThat(DubLines.isDub(80_000, 1, "이상입니다.", DIALOGUES)).isFalse();
        // 번역 문장은 늘 상세도 1
        assertThat(DubLines.isDub(20_000, 2, "총독: 금일 5월 15일.", DIALOGUES)).isFalse();
        // 한 글자는 우연히 겹칠 수 있어 보지 않는다
        assertThat(DubLines.isDub(30_000, 1, "총", DIALOGUES)).isFalse();
        assertThat(DubLines.isDub(20_000, 1, "금일 5월 15일.", List.of())).isFalse();
    }

    @Test
    void 공백이_달라도_같은_글로_본다() {
        assertThat(DubLines.isDub(30_000, 1, "태웅:  조선 최초의 기송관이  성공적으로 개통되었습니다.", DIALOGUES)).isTrue();
    }

    @Test
    void remove는_번역_문장만_뺀다() {
        DescriptionLine narration = line(19_500, 1, "총독이 단상에 선다.");
        DescriptionLine dub = line(20_000, 1, "총독: 금일 5월 15일.");
        DescriptionLine detail = line(21_000, 3, "총독은 흰 제복을 입었다.");
        TranscriptSegment segment = mock(TranscriptSegment.class);
        when(segment.getStartMs()).thenReturn(20_000);
        when(segment.getEndMs()).thenReturn(24_000);
        when(segment.getText()).thenReturn("금일 5월 15일.");

        assertThat(DubLines.remove(List.of(narration, dub, detail), List.of(segment))).containsExactly(narration, detail);
        assertThat(DubLines.remove(List.of(narration, dub), List.of())).containsExactly(narration, dub);
    }

    private static DescriptionLine line(int startMs, int level, String text) {
        DescriptionLine line = mock(DescriptionLine.class);
        when(line.getStartMs()).thenReturn(startMs);
        when(line.getDetailLevel()).thenReturn((short) level);
        when(line.getText()).thenReturn(text);
        return line;
    }
}
