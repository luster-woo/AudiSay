package com.audisay.domain.chat.seek;

import com.audisay.domain.chat.seek.KeywordSceneScorer.Decision;
import com.audisay.domain.chat.seek.KeywordSceneScorer.Hit;
import com.audisay.domain.chat.seek.KeywordSceneScorer.Result;
import com.audisay.domain.chat.tuning.ChatTuningProperties;
import com.audisay.domain.description.service.SceneText;
import com.audisay.domain.description.service.SceneText.Moment;
import com.audisay.domain.description.service.SceneText.MomentType;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class KeywordSceneScorerTest {
    private final KeywordSceneScorer scorer = new KeywordSceneScorer();

    /** 야구 중계. 목차에는 "안타"가 없고 캐스터 대사·화면 글자에만 있다 */
    private final List<SceneText> game = List.of(
            chapter(1, 0, 600_000, "1회 초 두산 공격", "두산 타자들이 타석에 들어섭니다.", List.of("1회", "두산", "공격"),
                    dialogue(30_000, "1번 타자 정수빈 타석에 들어섭니다"),
                    dialogue(95_000, "쳤습니다! 중견수 앞 안타!"),
                    narration(97_000, "타자가 공을 쳐서 1루로 달려갑니다"),
                    screen(99_000, "안타 정수빈"),
                    dialogue(300_000, "삼진입니다")),
            chapter(2, 600_000, 1_200_000, "1회 말 LG 공격", "LG 타자들이 공격합니다.", List.of("1회", "LG", "공격"),
                    dialogue(700_000, "볼넷으로 걸어 나갑니다"),
                    dialogue(900_000, "좌익수 앞 안타! 주자 2루까지")),
            chapter(3, 1_200_000, 1_800_000, "2회 초 홈런", "김재환이 홈런을 칩니다.", List.of("2회", "홈런", "김재환"),
                    dialogue(1_300_000, "넘어갑니다! 홈런!"),
                    dialogue(1_500_000, "우전 안타로 출루합니다")),
            chapter(4, 1_800_000, 2_400_000, "응원석 분위기", "관중들이 응원가를 부릅니다.", List.of("응원", "관중"),
                    narration(1_900_000, "관중들이 막대 풍선을 흔듭니다")));

    @Test
    void 여러_번_나오는_순간은_문장_시각으로_시간순_후보를_준다() {
        Result result = scorer.score("안타 친 장면", game, 0);

        assertThat(result.decision()).isEqualTo(Decision.MULTIPLE);
        assertThat(result.chosen()).extracting(Hit::targetMs).containsExactly(93_000, 898_000, 1_498_000);
        assertThat(result.chosen().get(0).snippet()).isEqualTo("쳤습니다! 중견수 앞 안타!");
    }

    @Test
    void 여러_번_나오면_개수_제한_없이_전부_준다() {
        List<SceneText> manyHits = List.of(chapter(1, 0, 3_600_000, "경기 전체", "야구 경기입니다.", List.of("야구"),
                dialogue(60_000, "안타!"), dialogue(400_000, "또 안타!"), dialogue(800_000, "안타입니다"),
                dialogue(1_200_000, "깨끗한 안타"), dialogue(1_600_000, "안타 하나 추가"), dialogue(2_000_000, "오늘 여섯 번째 안타")));

        Result result = scorer.score("안타 친 장면", manyHits, 0);

        assertThat(result.decision()).isEqualTo(Decision.MULTIPLE);
        assertThat(result.chosen()).hasSize(6);
    }

    @Test
    void 목차_제목에_있어_점수가_높은_곳이_있어도_다른_순간을_빼지_않는다() {
        List<SceneText> titled = List.of(
                chapter(1, 0, 600_000, "정수빈 첫 안타", "정수빈이 안타를 칩니다.", List.of("안타", "정수빈"),
                        dialogue(100_000, "중견수 앞 안타!")),
                chapter(2, 600_000, 1_200_000, "2회 공격", "타자들이 공격합니다.", List.of("2회"),
                        dialogue(900_000, "좌익수 앞 안타!")));

        Result result = scorer.score("안타 친 장면", titled, 0);

        assertThat(result.decision()).isEqualTo(Decision.MULTIPLE);
        assertThat(result.chosen()).extracting(Hit::targetMs).containsExactly(98_000, 898_000);
    }

    @Test
    void 지금_시각_이후_후보를_먼저_준다() {
        Result result = scorer.score("안타 친 장면", game, 950_000);

        assertThat(result.chosen()).extracting(Hit::targetMs).containsExactly(1_498_000, 93_000, 898_000);
    }

    @Test
    void 대사_화면_글자가_15초_안에_겹치면_한_번으로_친다() {
        Result result = scorer.score("안타 친 장면", game, 0);

        assertThat(result.hits()).hasSize(3);
    }

    @ParameterizedTest(name = "{0} → {1}ms")
    @CsvSource({
            "홈런 장면, 1298000",
            "정수빈 안타, 97000",
            "막대 풍선 흔드는 장면, 1898000",
            "삼진 당한 장면, 298000",
            "응원하는 장면, 1800000"
    })
    void 한_곳이_확실하면_그_순간_2초_전이나_목차_시작으로_바로_간다(String query, int targetMs) {
        Result result = scorer.score(query, game, 0);

        assertThat(result.decision()).isEqualTo(Decision.SINGLE);
        assertThat(result.chosen().get(0).targetMs()).isEqualTo(targetMs);
    }

    @Test
    void 맞는_곳이_없으면_LLM에_넘긴다() {
        Result result = scorer.score("도루하는 장면", game, 0);

        assertThat(result.decision()).isEqualTo(Decision.NONE);
        assertThat(result.chosen()).isEmpty();
    }

    @Test
    void 낱말이_절반도_안_맞는_곳은_후보가_아니다() {
        Result result = scorer.score("두산 도루 실패 장면", game, 0);

        assertThat(result.decision()).isEqualTo(Decision.NONE);
    }

    @Test
    void 일등과_이등이_비슷하면_둘_다_후보로_준다() {
        List<SceneText> sauces = List.of(
                chapter(1, 0, 60_000, "초콜릿 소스 만들기", "초콜릿 소스를 만듭니다.", List.of("초콜릿", "소스")),
                chapter(2, 60_000, 120_000, "딸기 소스 만들기", "딸기 소스를 만듭니다.", List.of("딸기", "소스")));

        Result result = scorer.score("소스 나오는 장면", sauces, 0);

        assertThat(result.decision()).isEqualTo(Decision.MULTIPLE);
        assertThat(result.chosen()).extracting(Hit::targetMs).containsExactly(0, 60_000);
    }

    @Test
    void 안타가_없었다는_말은_빼고_요약하는_말은_뒤로_민다() {
        List<SceneText> withTalk = List.of(chapter(1, 0, 1_200_000, "경기", "야구", List.of("야구"),
                dialogue(95_000, "쳤습니다! 중견수 앞 안타!"),
                screen(99_000, "안타 정수빈"),
                dialogue(480_000, "오늘 안타가 하나도 없네요"),
                dialogue(540_000, "안타를 못 쳤어요"),
                dialogue(900_000, "아웃 아니고 안타!"),
                dialogue(1_000_000, "지금까지 안타 3개째입니다")));

        Result result = scorer.score("안타 친 장면", withTalk, 0);

        assertThat(result.chosen()).extracting(Hit::snippet)
                .containsExactly("쳤습니다! 중견수 앞 안타!", "아웃 아니고 안타!", "지금까지 안타 3개째입니다");
        assertThat(result.hits().get(0).evidence()).isEqualTo(2);
        assertThat(result.hits()).extracting(Hit::snippet).last().isEqualTo("지금까지 안타 3개째입니다");
    }

    @Test
    void 부정_거르기를_끄면_부정_문장도_후보다() {
        KeywordSceneScorer noFilter = new KeywordSceneScorer(new ChatTuningProperties(true, true, false, true, true, true, true, true, true));
        List<SceneText> withTalk = List.of(chapter(1, 0, 600_000, "경기", "야구", List.of("야구"),
                dialogue(95_000, "중견수 앞 안타!"), dialogue(480_000, "오늘 안타가 하나도 없네요")));

        assertThat(noFilter.score("안타 친 장면", withTalk, 0).chosen()).hasSize(2);
        assertThat(scorer.score("안타 친 장면", withTalk, 0).chosen()).hasSize(1);
    }

    @ParameterizedTest(name = "{0} → {1}")
    @CsvSource(delimiter = '|', textBlock = """
            오늘 안타가 하나도 없네요 | true
            안타를 못 쳤어요       | true
            안타 없이 끝났어요      | true
            아웃 아니고 안타!      | false
            중견수 앞 안타!        | false
            """)
    void 낱말_뒤_같은_마디의_부정만_본다(String text, boolean negated) {
        assertThat(KeywordSceneScorer.negated(text, List.of("안타"))).isEqualTo(negated);
    }

    @ParameterizedTest(name = "{0} → {1}")
    @CsvSource(delimiter = '|', textBlock = """
            차가 공중에서 뒤집히는 장면       | 차,공중,뒤집히
            양들이 버스 타고 몰래 떠나는 장면    | 양들,버스,타고,몰래,떠나
            다 만들고 맛보는 장면             | 만들,맛보
            블루베리 올리는 데로 가 줘         | 블루베리,올리
            안타 친 장면                    | 안타
            """)
    void 조사와_어미를_떼고_흔한_말은_뺀다(String query, String expected) {
        assertThat(KeywordSceneScorer.terms(query)).containsExactly(expected.split(","));
    }

    @ParameterizedTest(name = "{0} → {1}")
    @CsvSource(delimiter = '|', textBlock = """
            튀기 | 튀겨
            묻히 | 묻혀
            모이 | 모여
            나오 | 나와
            세우 | 세워
            보 | 봐
            끄 | null
            안타 | null
            버스 | null
            """)
    void 끝_글자_모음이_줄어든_꼴(String term, String expected) {
        assertThat(KeywordSceneScorer.contracted(term)).isEqualTo("null".equals(expected) ? null : expected);
    }

    @Test
    void 줄어든_꼴로_쓴_장면도_후보다() {
        List<SceneText> scenes = List.of(
                chapter(1, 0, 60_000, "반죽 튀기기", "", List.of(), narration(10_000, "반죽을 기름에 넣어 튀깁니다.")),
                chapter(2, 60_000, 120_000, "남은 반죽 튀겨서 설탕 묻히기", "", List.of(),
                        narration(70_000, "남은 반죽도 노릇하게 튀겨냅니다.")));

        KeywordSceneScorer.Result result = scorer.score("반죽 튀기는", scenes, 0);

        assertThat(result.chosen()).extracting(h -> h.scene().chapterIndex()).containsExactly(1, 2);
    }

    private static SceneText chapter(int n, int startMs, int endMs, String title, String summary, List<String> keywords,
                                     Moment... moments) {
        return new SceneText((long) n, n, startMs, endMs, title, summary, keywords, "", List.of(moments));
    }

    private static Moment dialogue(int ms, String text) {
        return new Moment(ms, MomentType.DIALOGUE, text);
    }

    private static Moment narration(int ms, String text) {
        return new Moment(ms, MomentType.NARRATION, text);
    }

    private static Moment screen(int ms, String text) {
        return new Moment(ms, MomentType.SCREEN, text);
    }
}
