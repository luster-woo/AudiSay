package com.audisay.domain.description.service;

import com.audisay.domain.description.entity.Character;
import com.audisay.domain.description.entity.Description;
import com.audisay.domain.description.entity.DescriptionLine;
import com.audisay.domain.description.entity.Scene;
import com.audisay.domain.description.entity.ScreenText;
import com.audisay.domain.description.entity.TranscriptSegment;
import com.audisay.domain.description.repository.CharacterRepository;
import com.audisay.domain.description.repository.DescriptionLineRepository;
import com.audisay.domain.description.repository.DescriptionRepository;
import com.audisay.domain.description.repository.SceneRepository;
import com.audisay.domain.description.repository.ScreenTextRepository;
import com.audisay.domain.description.repository.TranscriptSegmentRepository;
import com.audisay.domain.video.entity.Video;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AnswerContextReaderTest {
    private static final long DESC = 9301L;

    private final DescriptionRepository descriptionRepository = mock(DescriptionRepository.class);
    private final SceneRepository sceneRepository = mock(SceneRepository.class);
    private final DescriptionLineRepository lineRepository = mock(DescriptionLineRepository.class);
    private final TranscriptSegmentRepository transcriptRepository = mock(TranscriptSegmentRepository.class);
    private final ScreenTextRepository screenTextRepository = mock(ScreenTextRepository.class);
    private final CharacterRepository characterRepository = mock(CharacterRepository.class);
    private final AnswerContextReader reader = new AnswerContextReader(descriptionRepository, sceneRepository,
            lineRepository, transcriptRepository, screenTextRepository, characterRepository);

    private final List<Scene> scenes = List.of(scene(0, 60_000, "1회 초"), scene(60_000, 120_000, "1회 말"),
            scene(120_000, 180_000, "2회 초"));

    @BeforeEach
    void setUp() {
        Video video = mock(Video.class);
        when(video.getTitle()).thenReturn("두산 대 LG");
        Description description = mock(Description.class);
        when(description.getVideo()).thenReturn(video);
        when(description.getSummaryText()).thenReturn("두산이 이겼어요.");
        when(descriptionRepository.findById(DESC)).thenReturn(Optional.of(description));
        when(sceneRepository.findByDescription_IdOrderBySceneIndexAsc(DESC)).thenReturn(scenes);
        when(lineRepository.findInRange(anyLong(), anyInt(), anyInt())).thenReturn(List.of());
        when(screenTextRepository.findByDescription_IdAndStartMsBetweenOrderByStartMsAsc(anyLong(), anyInt(), anyInt()))
                .thenReturn(List.of());
        when(transcriptRepository.findInRangeWithCharacter(anyLong(), anyInt(), anyInt())).thenReturn(List.of());
        when(characterRepository.findByDescription_IdOrderByIdAsc(DESC)).thenReturn(List.of());
    }

    @Test
    void 앞_장면과_지금_장면을_고른다() {
        assertThat(AnswerContextReader.pick(scenes, 90_000)).extracting(Scene::getTitle).containsExactly("1회 초", "1회 말");
        assertThat(AnswerContextReader.pick(scenes, 10_000)).extracting(Scene::getTitle).containsExactly("1회 초");
        assertThat(AnswerContextReader.pick(scenes, 999_000)).extracting(Scene::getTitle).containsExactly("1회 말", "2회 초");
        assertThat(AnswerContextReader.pick(List.of(), 0)).isEmpty();
    }

    @Test
    void 입력_시각까지의_문장_화면_글자와_앞_60초_대사만_모은다() {
        // 목 객체 만들기(when)를 다른 when(...).thenReturn 안에서 하면 Mockito가 거절해 먼저 만든다
        List<DescriptionLine> lines = List.of(line(30_000, "타자가 공을 칩니다"), line(70_000, "투수가 공을 던집니다"),
                line(85_000, "삼진입니다"));
        List<ScreenText> texts = List.of(screenText(65_000, "1회 말 0:0", null), screenText(66_000, "1회 말 0:0", null),
                screenText(80_000, null, "스트라이크"));
        Character kim = character("김현수", "등번호 22");
        Character crowd = character(null, "관중");
        List<TranscriptSegment> dialogues = List.of(dialogue(75_000, "삼진!", kim), dialogue(88_000, "좋아요", null));
        when(lineRepository.findInRange(DESC, 0, 90_000)).thenReturn(lines);
        when(screenTextRepository.findByDescription_IdAndStartMsBetweenOrderByStartMsAsc(DESC, 0, 90_000)).thenReturn(texts);
        when(transcriptRepository.findInRangeWithCharacter(DESC, 30_000, 90_000)).thenReturn(dialogues);
        when(characterRepository.findByDescription_IdOrderByIdAsc(DESC)).thenReturn(List.of(kim, crowd));

        AnswerContext context = reader.read(DESC, 90_000).orElseThrow();

        assertThat(context.videoTitle()).isEqualTo("두산 대 LG");
        assertThat(context.summary()).isEqualTo("두산이 이겼어요.");
        assertThat(context.scenes()).hasSize(2);
        assertThat(context.scenes().get(0).narrations()).containsExactly(new AnswerContext.Narration(30_000, "타자가 공을 칩니다"));
        assertThat(context.currentScene().title()).isEqualTo("1회 말");
        assertThat(context.currentScene().narrations()).containsExactly(
                new AnswerContext.Narration(70_000, "투수가 공을 던집니다"), new AnswerContext.Narration(85_000, "삼진입니다"));
        assertThat(context.currentScene().screenTexts()).containsExactly("1회 말 0:0", "스트라이크");
        assertThat(context.recentDialogues()).extracting(AnswerContext.Dialogue::speaker).containsExactly("김현수", null);
        assertThat(context.characters()).extracting(AnswerContext.Person::name).containsExactly("김현수");
    }

    @Test
    void 영상_앞부분이면_대사는_0부터_첫_장면_전이면_문장은_없다() {
        List<Scene> late = List.of(scene(20_000, 60_000, "시작"));
        when(sceneRepository.findByDescription_IdOrderBySceneIndexAsc(DESC)).thenReturn(late);

        AnswerContext context = reader.read(DESC, 5_000).orElseThrow();

        assertThat(context.scenes()).extracting(AnswerContext.SceneInfo::title).containsExactly("시작");
        verify(lineRepository).findInRange(DESC, 5_000, 5_000);
        verify(transcriptRepository).findInRangeWithCharacter(DESC, 0, 5_000);
    }

    @Test
    void 바로_하는_답은_요약과_끝나지_않은_장면의_제목_설명을_뺀다() {
        AnswerContext context = reader.read(DESC, 90_000, true).orElseThrow();

        assertThat(context.summary()).isNull();
        assertThat(context.scenes().get(0).title()).isEqualTo("1회 초");
        assertThat(context.scenes().get(0).description()).isEqualTo("1회 초 설명");
        assertThat(context.currentScene().title()).isNull();
        assertThat(context.currentScene().description()).isNull();
    }

    @Test
    void 뒤_자료는_지금_장면부터_끝까지_질문한_시각_뒤만() {
        List<DescriptionLine> lines = List.of(line(100_000, "홈런입니다"), line(150_000, "2회가 시작됩니다"));
        when(lineRepository.findInRange(DESC, 90_001, Integer.MAX_VALUE)).thenReturn(lines);

        FutureContext future = reader.readFuture(DESC, 90_000).orElseThrow();

        assertThat(future.summary()).isEqualTo("두산이 이겼어요.");
        assertThat(future.scenes()).extracting(AnswerContext.SceneInfo::title).containsExactly("1회 말", "2회 초");
        assertThat(future.scenes().get(0).description()).isEqualTo("1회 말 설명");
        assertThat(future.scenes().get(0).narrations()).containsExactly(new AnswerContext.Narration(100_000, "홈런입니다"));
        assertThat(future.scenes().get(1).narrations()).containsExactly(new AnswerContext.Narration(150_000, "2회가 시작됩니다"));
        verify(transcriptRepository).findInRangeWithCharacter(DESC, 90_001, Integer.MAX_VALUE);
    }

    @Test
    void 화면_글자는_장면_시각이라_바로_하는_답에선_끝나지_않은_것을_빼고_뒤_자료로_넘긴다() {
        // AI는 화면 글자에 장면의 시작·끝을 넣는다: 지난 장면(0~60초) 글자는 끝났고, 지금 장면(60~120초) 글자는 아직
        List<ScreenText> past = List.of(screenText(0, 60_000, "1회 초 0:0"), screenText(60_000, 120_000, "최종 3:2"));
        List<ScreenText> future = List.of(screenText(60_000, 120_000, "최종 3:2"), screenText(120_000, 180_000, "2회 초"));
        when(screenTextRepository.findByDescription_IdAndStartMsBetweenOrderByStartMsAsc(DESC, 0, 90_000)).thenReturn(past);
        when(screenTextRepository.findByDescription_IdAndStartMsBetweenOrderByStartMsAsc(DESC, 60_000, Integer.MAX_VALUE))
                .thenReturn(future);

        AnswerContext context = reader.read(DESC, 90_000, true).orElseThrow();
        FutureContext later = reader.readFuture(DESC, 90_000).orElseThrow();

        assertThat(context.scenes().get(0).screenTexts()).containsExactly("1회 초 0:0");
        assertThat(context.currentScene().screenTexts()).isEmpty();
        assertThat(later.scenes().get(0).screenTexts()).containsExactly("최종 3:2");
        assertThat(later.scenes().get(1).screenTexts()).containsExactly("2회 초");
        // 바로 하는 답이 아니거나 지금 장면 설명(SCENE_NOW)이면 그대로 넣는다
        assertThat(reader.read(DESC, 90_000, false).orElseThrow().currentScene().screenTexts()).containsExactly("최종 3:2");
        assertThat(reader.read(DESC, 90_000, true, false).orElseThrow().currentScene().screenTexts())
                .containsExactly("최종 3:2");
    }

    @Test
    void 끝나지_않은_장면의_화면_글자도_해설이_이미_읽었으면_바로_하는_답에_넣고_뒤_자료에선_뺀다() {
        ScreenText read = screenText(60_000, 120_000, "냉동실에서 약 20~30분 정도 굳혀주세요");
        ScreenText notYet = screenText(60_000, 120_000, "약 170도에서 5분 정도 튀겨 주세요");
        when(screenTextRepository.findByDescription_IdAndStartMsBetweenOrderByStartMsAsc(DESC, 0, 90_000))
                .thenReturn(List.of(read, notYet));
        when(screenTextRepository.findByDescription_IdAndStartMsBetweenOrderByStartMsAsc(DESC, 60_000, Integer.MAX_VALUE))
                .thenReturn(List.of(read, notYet));
        List<DescriptionLine> scene = List.of(line(70_000, "냉동실에서 20분에서 30분 정도 반죽을 굳힙니다."),
                line(100_000, "170도로 달군 기름에 5분 정도 튀깁니다."));
        when(lineRepository.findInRange(DESC, 60_000, 120_000)).thenReturn(scene);

        AnswerContext context = reader.read(DESC, 90_000, true).orElseThrow();
        FutureContext later = reader.readFuture(DESC, 90_000).orElseThrow();

        assertThat(context.currentScene().screenTexts()).containsExactly("냉동실에서 약 20~30분 정도 굳혀주세요");
        assertThat(later.scenes().get(0).screenTexts()).containsExactly("약 170도에서 5분 정도 튀겨 주세요");
    }

    @Test
    void 해설이_없으면_비어_있다() {
        assertThat(reader.read(1L, 0)).isEmpty();
    }

    private static Scene scene(int start, int end, String title) {
        Scene scene = mock(Scene.class);
        when(scene.getStartMs()).thenReturn(start);
        when(scene.getEndMs()).thenReturn(end);
        when(scene.getTitle()).thenReturn(title);
        when(scene.getSceneDescription()).thenReturn(title + " 설명");
        return scene;
    }

    private static DescriptionLine line(int start, String text) {
        DescriptionLine line = mock(DescriptionLine.class);
        when(line.getStartMs()).thenReturn(start);
        when(line.getText()).thenReturn(text);
        return line;
    }

    private static ScreenText screenText(int start, int end, String fullText) {
        ScreenText text = screenText(start, null, fullText);
        when(text.getEndMs()).thenReturn(end);
        return text;
    }

    private static ScreenText screenText(int start, String headline, String fullText) {
        ScreenText text = mock(ScreenText.class);
        when(text.getStartMs()).thenReturn(start);
        when(text.getHeadline()).thenReturn(headline);
        when(text.getFullText()).thenReturn(fullText);
        return text;
    }

    private static TranscriptSegment dialogue(int start, String text, Character character) {
        TranscriptSegment segment = mock(TranscriptSegment.class);
        when(segment.getStartMs()).thenReturn(start);
        when(segment.getText()).thenReturn(text);
        when(segment.getCharacter()).thenReturn(character);
        return segment;
    }

    private static Character character(String name, String appearance) {
        Character character = mock(Character.class);
        when(character.getName()).thenReturn(name);
        when(character.getAppearance()).thenReturn(appearance);
        return character;
    }
}
