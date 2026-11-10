package com.audisay.domain.chat.screen;

import com.audisay.domain.chat.screen.ScreenAnswerJudge.Kind;
import com.audisay.domain.chat.screen.ScreenAnswerJudge.Verdict;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.util.Arrays;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** 실제 스파이크 답(backend/build/eval/results/*-requery)으로 만든 경우들 */
class ScreenAnswerJudgeTest {

    @ParameterizedTest(name = "{0} → {1}")
    @CsvSource(delimiter = '|', textBlock = """
            쌀은 몇 컵 넣어? | NUMERIC
            지금 킬 스코어 몇 대 몇이야? | NUMERIC
            지금 페이커 KDA가 몇이야? | NUMERIC
            이거 파는 가격이 얼마야? | NUMERIC
            기름 온도 몇 도야? | NUMERIC
            배에 몇 명 타고 있어? | COUNT
            고양이 몇 마리야? | COUNT
            지금 나온 기자 이름이 뭐야? | GENERAL
            트랙터 무슨 색이야? | GENERAL
            기자 뒤에 뭐가 보여? | GENERAL
            """)
    void 질문_종류(String question, Kind expected) {
        assertThat(ScreenAnswerJudge.kind(question)).isEqualTo(expected);
    }

    @Test
    void 숫자는_한글_수와_구분자까지_낱개로() {
        assertThat(ScreenAnswerJudge.numbers("KDA는 0/0/1이에요.")).containsExactly("0", "0", "1");
        assertThat(ScreenAnswerJudge.numbers("삼성이 2-1로 역전")).containsExactly("2", "1");
        assertThat(ScreenAnswerJudge.numbers("캐릭터 다섯 명이 타고 있어요.")).containsExactly("5");
        assertThat(ScreenAnswerJudge.numbers("네, 그래요")).isEmpty();
        assertThat(ScreenAnswerJudge.numbers("냄비는 검은색이에요.")).isEmpty();
    }

    @Test
    void 두_모델의_숫자가_같으면_주_모델_답() {
        assertThat(ScreenAnswerJudge.pair("1999년 과학 1위, 수학 6위였어요.", "과학 1위, 수학 6위였어요."))
                .extracting(Verdict::text, Verdict::answered)
                .containsExactly("1999년 과학 1위, 수학 6위였어요.", true);
        assertThat(ScreenAnswerJudge.pair("킬 스코어는 T1 0대 BLG 3이에요.", "킬 스코어는 0 대 3이에요.")).isNotNull();
    }

    @Test
    void 두_모델의_숫자가_다르면_정하지_않는다() {
        assertThat(ScreenAnswerJudge.pair("Faker의 KDA는 0/2/1이에요.", "KDA는 1/0/3이에요.")).isNull();
        // 숫자 하나는 집합이 같을 때만: '2회'와 '2대 1'은 다른 값
        assertThat(ScreenAnswerJudge.pair("2회에 이어 적시타라는 자막이 있어요.", "삼성이 2대 1로 역전했어요.")).isNull();
    }

    @Test
    void 모른다는_답은_답이_아니다() {
        Verdict verdict = ScreenAnswerJudge.pair("기자의 나이는 확인할 수 없어요.", "나이를 확인할 수 없습니다.");
        assertThat(verdict.answered()).isFalse();
        assertThat(ScreenAnswerJudge.pair(null, "가격 정보는 화면에 나와 있지 않아요.").answered()).isFalse();
        // 2026-11-10 새 영상 평가 n12: 읽지 못했다는 답을 답으로 쳤다
        assertThat(ScreenAnswerJudge.single("화면이 작고 희미해서 컵에 적은 글자는 확실히 읽을 수 없어요.").answered()).isFalse();
    }

    @Test
    void 다수결() {
        assertThat(vote("킬 스코어는 0 대 0이에요.", "킬 스코어는 0 대 3이에요.", "T1이 0, BLG가 3으로 0 대 3이에요.").text())
                .isEqualTo("킬 스코어는 0 대 3이에요.");
        // 게임 시각은 분까지만 맞으면 같다
        assertThat(vote("게임 시간은 24분 20초예요.", "게임 시간은 5분 40초예요.", "게임 시간은 24분 50초예요.").text())
                .isEqualTo("게임 시간은 24분 20초예요.");
        // 작은 HUD 숫자는 모델마다 달랐다(실제 0/0/1)
        assertThat(vote("KDA는 1/2/2예요.", "KDA는 1/0/3이에요.", "0킬 0데스 2어시스트예요."))
                .extracting(Verdict::text, Verdict::answered)
                .containsExactly(ScreenAnswerJudge.UNSURE, false);
        // 점수판이 없는 화면: 싼 모델만 "2개"를 지어냈다
        assertThat(vote("아웃카운트가 표시되지 않아 확인할 수 없어요.", "아웃카운트는 2개예요.", "아웃카운트 정보가 없어요.")
                .answered()).isFalse();
        assertThat(vote(null, null, null)).isNull();
    }

    @Test
    void 개수는_범위로() {
        assertThat(count("지금 몇 명이 먹고 있어?", "한 사람이 먹고 있어요.", "남성 한 명이 혼자 먹어요.", "한 명이 먹어요.").text())
                .isEqualTo("화면에 보이는 것만 세면 1명이에요.");
        assertThat(count("지금 달리는 사람 몇 명이야?", "2명의 학생", "두 명의 학생", "4명이 달려요").text())
                .isEqualTo("화면에 보이는 것만 세면 2~4명 정도예요. 가려진 것이 있을 수 있어요.");
        // 두 모델이 똑같이 4명이라고 해도(실제 6명) 셋째가 9명이면 믿지 않는다
        assertThat(count("배에 몇 명 타고 있어?", "작은 캐릭터 4명이에요.", "총 4명이에요.", "총 9명이에요."))
                .extracting(Verdict::text, Verdict::answered)
                .containsExactly(ScreenAnswerJudge.COUNT_UNSURE, false);
        assertThat(count("고양이 몇 마리야?", "고양이 세 마리", "3마리", "3마리").text())
                .isEqualTo("화면에 보이는 것만 세면 3마리예요.");
        // 센 모델이 하나뿐이면 믿지 않는다
        assertThat(count("배에 몇 명 타고 있어?", "확인할 수 없어요.", "총 4명", null).answered()).isFalse();
    }

    @ParameterizedTest(name = "{0} → {1}")
    @CsvSource(delimiter = '|', textBlock = """
            우리카드 유니폼 무슨 색이야? | true
            가운데 플러스 모델은 무슨 색이야? | true
            우유 팩에 뭐라고 써 있어? | true
            감독 모자 무슨 색이야? | true
            농부가 창문을 깨? | false
            시속 60마일까지 몇 초 걸렸어? | false
            차가 마지막에 어떻게 착지해? | false
            다음 타자는 안타 쳐? | false
            냉동실에 얼마나 둬? | false
            튀길 때 기름 온도는 몇 도야? | false
            양들이 어디로 가? | false
            """)
    void 뒤에_답이_있어도_화면을_먼저_볼_질문(String question, boolean expected) {
        assertThat(ScreenAnswerJudge.appearance(question)).isEqualTo(expected);
    }

    @Test
    void 글자_내용을_물었는데_내용_없이_끝난_답() {
        assertThat(ScreenAnswerJudge.textNotRead("메모지에 뭐 해야 한다고 적혀 있어?", "노란 메모지에는 마감 할 일 목록이 적혀 있습니다."))
                .isTrue();
        assertThat(ScreenAnswerJudge.textNotRead("우유 팩에 뭐라고 써 있어?", "우유 팩에 글자가 적혀 있어요.")).isTrue();
        // 내용을 옮겼거나 글자를 묻지 않은 질문이면 아니다
        assertThat(ScreenAnswerJudge.textNotRead("간판에 뭐라고 써 있어?", "간판에는 '컴포즈커피'라는 글자가 적혀 있어요.")).isFalse();
        assertThat(ScreenAnswerJudge.textNotRead("메모지에 뭐 적혀 있어?", "휘핑크림 만들기, 블루베리 퓨레 만들기예요.")).isFalse();
        assertThat(ScreenAnswerJudge.textNotRead("지금 뭐 하고 있어?", "메모지에 목록이 적혀 있어요.")).isFalse();
    }

    private static Verdict vote(String... answers) {
        return ScreenAnswerJudge.vote(Arrays.asList(answers));
    }

    private static Verdict count(String question, String... answers) {
        List<String> list = Arrays.asList(answers);
        return ScreenAnswerJudge.count(list, question);
    }
}
