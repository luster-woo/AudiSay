package com.audisay.domain.chat.seek;

import com.audisay.domain.chat.search.VectorLine;
import com.audisay.domain.chat.seek.KeywordSceneScorer.Hit;
import com.audisay.domain.description.service.SceneText;
import com.audisay.domain.description.service.SceneText.Moment;
import com.audisay.domain.description.service.SceneText.MomentType;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class HybridSceneRankerTest {
    private final Moment butter = new Moment(15_000, MomentType.NARRATION, "프라이팬에 무염버터를 넣습니다.");
    private final Moment flour = new Moment(42_000, MomentType.NARRATION, "중력분을 체쳐 넣습니다.");
    private final SceneText first = new SceneText(1L, 1, 0, 40_000, "버터 끓이기", "", List.of(), "버터와 우유를 끓입니다.",
            List.of(butter));
    private final SceneText second = new SceneText(2L, 2, 40_000, 91_000, "가루 섞기", "", List.of(), "가루를 섞습니다.",
            List.of(flour));
    private final List<SceneText> scenes = List.of(first, second);

    @Test
    void 양쪽에_다_있는_후보가_먼저_오고_10초_안은_하나로_묶는다() {
        // 장면 설명 줄(0초)은 그 장면의 버터 줄(13초)로 옮겨져 키워드 후보와 하나가 된다
        Hit keywordButter = new Hit(first, 13_000, 5.0, 1, butter, butter.text(), 1);
        List<VectorLine> lines = List.of(
                new VectorLine("NARRATION", 2L, 42_000, flour.text(), 0.7),
                new VectorLine("NARRATION", 1L, 15_000, butter.text(), 0.6),
                new VectorLine("SCENE", 1L, 0, "버터와 우유를 끓입니다.", 0.5));

        List<Hit> fused = HybridSceneRanker.fuse(List.of(keywordButter), lines, scenes, 5);

        assertThat(fused).extracting(Hit::targetMs).containsExactly(13_000, 40_000);
        assertThat(fused.get(0).moment()).isSameAs(butter);
    }

    @Test
    void 벡터_줄은_장면의_Moment로_바꾸고_2초_전으로_가되_장면_시작보다_앞서지_않는다() {
        Hit hit = HybridSceneRanker.toHit(new VectorLine("NARRATION", 2L, 42_000, flour.text(), 0.7), scenes);

        assertThat(hit.scene()).isSameAs(second);
        assertThat(hit.moment()).isSameAs(flour);
        assertThat(hit.targetMs()).isEqualTo(40_000);
    }

    @Test
    void 장면_설명_줄은_장면_시작으로_간다() {
        Hit hit = HybridSceneRanker.toHit(new VectorLine("SCENE", 2L, 40_000, "가루를 섞습니다.", 0.4), scenes);

        assertThat(hit.targetMs()).isEqualTo(40_000);
        assertThat(hit.moment()).isNull();
    }

    @Test
    void 장면_설명으로_찾은_후보는_그_장면에서_가장_비슷한_줄로_옮긴다() {
        List<VectorLine> lines = List.of(
                new VectorLine("SCENE", 2L, 40_000, "가루를 섞습니다.", 0.8),
                new VectorLine("NARRATION", 1L, 15_000, butter.text(), 0.6),
                new VectorLine("NARRATION", 2L, 42_000, flour.text(), 0.5));

        List<Hit> fused = HybridSceneRanker.fuse(List.of(), lines, scenes, 5);

        assertThat(fused).extracting(Hit::targetMs).containsExactly(40_000, 13_000);
        assertThat(fused.get(0).moment()).isSameAs(flour);
    }

    @Test
    void 키워드_후보와_묶이면_특정_줄을_가리키는_벡터_후보를_대표로_쓴다() {
        Moment plate = new Moment(41_000, MomentType.NARRATION, "접시에 담습니다.");
        SceneText scene = new SceneText(2L, 2, 40_000, 91_000, "가루 섞기", "", List.of(), "", List.of(plate, flour));
        Hit keywordEarliest = new Hit(scene, 40_000, 3.0, 1, plate, plate.text(), 2);

        List<Hit> fused = HybridSceneRanker.fuse(List.of(keywordEarliest),
                List.of(new VectorLine("NARRATION", 2L, 42_000, flour.text(), 0.7)), List.of(first, scene), 5);

        assertThat(fused).hasSize(1);
        assertThat(fused.get(0).moment()).isSameAs(flour);
    }

    @Test
    void 개수를_넘으면_자른다() {
        List<VectorLine> lines = List.of(
                new VectorLine("NARRATION", 1L, 15_000, butter.text(), 0.9),
                new VectorLine("NARRATION", 2L, 42_000, flour.text(), 0.8));

        assertThat(HybridSceneRanker.fuse(List.of(), lines, scenes, 1)).extracting(Hit::targetMs).containsExactly(13_000);
    }
}
