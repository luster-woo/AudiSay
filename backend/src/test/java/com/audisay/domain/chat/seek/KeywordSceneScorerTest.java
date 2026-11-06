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
            안타 시도가 막혔어요    | true
            안타가 될 만한 타구였어요 | true
            안타를 시도해 성공합니다  | false
            """)
    void 낱말_뒤_같은_마디의_부정만_본다(String text, boolean negated) {
        assertThat(KeywordSceneScorer.negated(text, List.of("안타"))).isEqualTo(negated);
    }

    @ParameterizedTest(name = "{0} → {1}")
    @CsvSource(delimiter = '|', textBlock = """
            패스 못 받는 장면     | true
            골이 안 들어간 장면   | true
            득점 없는 장면       | true
            공을 잡지 못한 장면   | true
            연못에 빠지는 장면    | false
            집 안 장면         | false
            안타 치는 장면       | false
            """)
    void 검색어_자체의_부정은_어절_첫머리로_본다(String query, boolean negates) {
        assertThat(KeywordSceneScorer.negates(query)).isEqualTo(negates);
    }

    @Test
    void 끝_글자를_뗀_낱말이_문장_끝에서_맞아도_예외가_나지_않는다() {
        assertThat(KeywordSceneScorer.negated("역전", List.of("역전골"))).isFalse();
        assertThat(KeywordSceneScorer.negated("드디어 역전", List.of("역전골"))).isFalse();
        assertThat(KeywordSceneScorer.negated("역전 못 했어요", List.of("역전골"))).isTrue();
        assertThat(KeywordSceneScorer.negated("역전못함", List.of("역전골"))).isTrue();
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

    @ParameterizedTest
    @CsvSource(delimiter = '|', textBlock = """
            손흥민의 선제골입니다 | 골 | true
            오세훈이 헤더골로 쐐기를 박습니다 | 골 | true
            추가골! | 골 | true
            골키퍼가 막아 냅니다 | 골 | true
            시골 마을 풍경 | 골 | false
            다양한 모양을 만듭니다 | 양 | false
            자동차가 지나갑니다 | 차 | true
            """)
    void 한_글자_낱말은_맨_앞이나_세_글자_이상_합성어_끝에서_맞는다(String text, String term, boolean expected) {
        assertThat(KeywordSceneScorer.contains(text, term)).isEqualTo(expected);
    }

    @Test
    void 골_넣은_장면은_선제골과_헤더골을_모두_후보로_준다() {
        List<SceneText> scenes = List.of(
                chapter(1, 0, 60_000, "경기 시작", "", List.of(), narration(10_000, "선수들이 입장합니다.")),
                chapter(2, 60_000, 120_000, "손흥민 득점", "", List.of(), narration(86_000, "손흥민이 왼발로 선제골을 넣습니다.")),
                chapter(3, 120_000, 180_000, "오세훈 득점", "", List.of(),
                        narration(150_000, "오세훈이 머리로 받아 넣은 헤더골입니다.")));

        Result result = scorer.score("골 넣은 장면", scenes, 0);

        assertThat(result.decision()).isEqualTo(Decision.MULTIPLE);
        assertThat(result.chosen()).extracting(Hit::targetMs).containsExactly(84_000, 148_000);
    }

    /** 축구 하이라이트: 실제 골 2개 + 리플레이 + 득점 '시도'·'될 만한'·'될 수도' 같은 일어나지 않은 득점 */
    private final List<SceneText> soccer = List.of(
            chapter(1, 0, 84_000, "경기 시작", "", List.of(), narration(10_000, "선수들이 입장합니다.")),
            chapter(2, 84_000, 104_000, "손흥민의 프리킥 득점 후 세리머니 장면", "", List.of(),
                    narration(86_000, "손흥민이 오른발 프리킥 슈팅으로 득점에 성공한다.")),
            chapter(3, 104_000, 131_000, "손흥민의 프리킥 골 리플레이 장면", "", List.of(),
                    narration(106_000, "프리킥 득점 장면의 리플레이가 재생된다.")),
            chapter(4, 131_000, 334_000, "우즈베키스탄의 득점 시도와 오프사이드 판정", "", List.of(),
                    narration(133_000, "우즈베키스탄 선수가 침투 패스를 받아 박스 안으로 침투한다.")),
            chapter(5, 334_000, 440_000, "손흥민의 강력한 프리킥 슈팅과 골키퍼의 선방", "", List.of(),
                    dialogue(336_000, "아 지금도 충분히 득점이 될 만한 궤적이지 않았나 생각이 들고요.")),
            chapter(6, 440_000, 469_000, "오세훈의 헤더 추가골과 동료들의 축하 세리머니", "", List.of(),
                    dialogue(442_000, "오세훈의 높이이기에 가능한 득점이 나옵니다.")),
            chapter(7, 469_000, 600_000, "오세훈 추가골 장면의 다각도 리플레이", "", List.of(),
                    narration(471_000, "손흥민이 환하게 웃으며 오세훈의 득점을 축하한다.")),
            chapter(8, 600_000, 700_000, "황인범의 중거리 굴절 슈팅 공격", "", List.of(),
                    dialogue(600_000, "상대 굴절이 발생하면 이런 슈팅들이 또 득점이 될 수도 있죠.")));

    @Test
    void 득점_시도와_될_만한_득점과_리플레이는_빼고_실제_득점만_준다() {
        Result result = scorer.score("득점 장면", soccer, 0);

        assertThat(result.chosen()).extracting(h -> h.scene().chapterIndex()).containsExactly(2, 6);
    }

    @Test
    void 검색어가_시도를_찾으면_시도_장면을_빼지_않는다() {
        Result result = scorer.score("득점 시도 장면", soccer, 0);

        assertThat(result.hits()).extracting(h -> h.scene().chapterIndex()).contains(4);
    }

    @Test
    void 검색어가_리플레이를_찾으면_리플레이도_준다() {
        Result result = scorer.score("득점 리플레이", soccer, 0);

        assertThat(result.chosen()).extracting(h -> h.scene().chapterIndex()).contains(3);
    }

    @ParameterizedTest(name = "{0} → {1}")
    @CsvSource(delimiter = '|', textBlock = """
            골 넣은 장면 | 골
            두 번째 골 장면 | 골
            첫 골 | 골
            마지막 골 장면 | 골
            2대 0 된 장면 | 2:0
            첫눈 오는 장면 | 첫눈,오
            """)
    void 골에_붙는_동사_순서_말_점수를_낱말로_다룬다(String query, String expected) {
        assertThat(KeywordSceneScorer.terms(query)).containsExactly(expected.split(","));
    }

    @Test
    void 점수는_대_쌍점_줄표를_같게_보고_다른_숫자에_걸리지_않는다() {
        assertThat(KeywordSceneScorer.contains("대한민국 2 : 0 우즈베키스탄", "2:0")).isTrue();
        assertThat(KeywordSceneScorer.contains("2대0으로 앞서 갑니다", "2:0")).isTrue();
        assertThat(KeywordSceneScorer.contains("12:05에 시작", "2:0")).isFalse();
    }

    @Test
    void 골은_득점이라고_쓴_해설에서도_찾는다() {
        Result result = scorer.score("골 넣은 장면", soccer, 0);

        assertThat(result.chosen()).extracting(h -> h.scene().chapterIndex()).containsExactly(2, 6);
    }

    @Test
    void 순서를_말하면_찾은_곳_중_시간순으로_그_번째만() {
        List<Hit> hits = scorer.score("골 장면", soccer, 200_000).chosen();

        assertThat(KeywordSceneScorer.pickOrdinal("두 번째 골 장면", hits)).extracting(h -> h.scene().chapterIndex())
                .containsExactly(6);
        assertThat(KeywordSceneScorer.pickOrdinal("첫 골", hits)).extracting(h -> h.scene().chapterIndex())
                .containsExactly(2);
        assertThat(KeywordSceneScorer.pickOrdinal("마지막 골", hits)).extracting(h -> h.scene().chapterIndex())
                .containsExactly(6);
        assertThat(KeywordSceneScorer.pickOrdinal("골 장면", hits)).hasSize(2);
        assertThat(KeywordSceneScorer.pickOrdinal("세 번째 골", hits)).hasSize(2);
    }

    @Test
    void 목차_제목이_검색어를_다_담았는지_본다() {
        SceneText defense = chapter(1, 0, 60_000, "9회 말 김지찬의 다이빙 캐치 수비", "", List.of());
        SceneText attempt = chapter(2, 60_000, 120_000, "우즈베키스탄의 득점 시도와 오프사이드", "", List.of());

        assertThat(KeywordSceneScorer.titleCovers(KeywordSceneScorer.terms("9회 말 수비 장면"), defense)).isTrue();
        assertThat(KeywordSceneScorer.titleCovers(KeywordSceneScorer.terms("수비 장면"), defense)).isFalse(); // 두 글자 낱말 하나뿐
        assertThat(KeywordSceneScorer.titleCovers(KeywordSceneScorer.terms("10회 말 수비"), defense)).isFalse();
        assertThat(KeywordSceneScorer.titleCovers(KeywordSceneScorer.terms("우즈베키스탄 득점"), attempt)).isFalse(); // 시도
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
