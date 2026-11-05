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
import com.audisay.domain.description.service.AnswerContext.Dialogue;
import com.audisay.domain.description.service.AnswerContext.Narration;
import com.audisay.domain.description.service.AnswerContext.Person;
import com.audisay.domain.description.service.AnswerContext.SceneInfo;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * 답변 자료를 모은다. AI ai/app/chat/answer.py context()를 옮기고, 명세대로 장면별 해설 문장(v1~v3)을 더했다.
 * 모델 비교 스파이크 평가셋과 같은 모양(앞 장면·지금 장면, 앞 60초 대사, 30초 요약, 이름 있는 인물)
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class AnswerContextReader {
    static final int RECENT_DIALOGUE_MS = 60_000;
    static final int MAX_NARRATIONS = 12;
    static final int MAX_SCREEN_TEXTS = 8;
    static final int MAX_CHARACTERS = 10;

    private final DescriptionRepository descriptionRepository;
    private final SceneRepository sceneRepository;
    private final DescriptionLineRepository descriptionLineRepository;
    private final TranscriptSegmentRepository transcriptSegmentRepository;
    private final ScreenTextRepository screenTextRepository;
    private final CharacterRepository characterRepository;

    public Optional<AnswerContext> read(Long descriptionId, int nowMs) {
        return read(descriptionId, nowMs, false);
    }

    /**
     * @param pastOnly true면 질문한 시각까지 자료만: 요약(영상 전체)과 아직 끝나지 않은 장면의 제목·설명(장면 전체 글)을 뺀다
     */
    public Optional<AnswerContext> read(Long descriptionId, int nowMs, boolean pastOnly) {
        Optional<Description> description = descriptionRepository.findById(descriptionId);
        if (description.isEmpty()) {
            return Optional.empty();
        }
        int now = Math.max(0, nowMs);
        List<Scene> scenes = pick(sceneRepository.findByDescription_IdOrderBySceneIndexAsc(descriptionId), now);
        int from = scenes.isEmpty() ? now : Math.min(scenes.get(0).getStartMs(), now);
        List<DescriptionLine> lines = descriptionLineRepository.findInRange(descriptionId, from, now);
        List<ScreenText> texts = screenTextRepository
                .findByDescription_IdAndStartMsBetweenOrderByStartMsAsc(descriptionId, from, now);

        List<SceneInfo> sceneInfos = scenes.stream().map(scene -> new SceneInfo(scene.getStartMs(),
                pastOnly && scene.getEndMs() > now ? null : scene.getTitle(),
                pastOnly && scene.getEndMs() > now ? null : scene.getSceneDescription(),
                last(lines.stream().filter(l -> inScene(l.getStartMs(), scene))
                        .map(l -> new Narration(l.getStartMs(), l.getText())).toList(), MAX_NARRATIONS),
                last(texts.stream().filter(t -> inScene(t.getStartMs(), scene)).map(AnswerContextReader::screenText)
                        .filter(t -> t != null && !t.isBlank()).distinct().toList(), MAX_SCREEN_TEXTS))).toList();

        List<Dialogue> dialogues = transcriptSegmentRepository
                .findInRangeWithCharacter(descriptionId, Math.max(0, now - RECENT_DIALOGUE_MS), now).stream()
                .map(t -> new Dialogue(t.getStartMs(), t.getCharacter() == null ? null : t.getCharacter().getName(),
                        t.getText()))
                .toList();
        List<Person> characters = characterRepository.findByDescription_IdOrderByIdAsc(descriptionId).stream()
                .filter(c -> c.getName() != null && !c.getName().isBlank())
                .limit(MAX_CHARACTERS)
                .map(c -> new Person(c.getName(), c.getAppearance()))
                .toList();

        Description d = description.get();
        return Optional.of(new AnswerContext(d.getVideo().getTitle(), pastOnly ? null : d.getSummaryText(), now, sceneInfos,
                dialogues, characters));
    }

    /** 질문한 시각 뒤 자료: 요약, 지금 장면부터 끝까지(설명 전체, 시각 뒤 해설 문장·화면 글자), 시각 뒤 대사 */
    public Optional<FutureContext> readFuture(Long descriptionId, int nowMs) {
        Optional<Description> description = descriptionRepository.findById(descriptionId);
        if (description.isEmpty()) {
            return Optional.empty();
        }
        int now = Math.max(0, nowMs);
        int from = now + 1;
        List<Scene> scenes = sceneRepository.findByDescription_IdOrderBySceneIndexAsc(descriptionId).stream()
                .filter(scene -> scene.getEndMs() > now)
                .toList();
        List<DescriptionLine> lines = descriptionLineRepository.findInRange(descriptionId, from, Integer.MAX_VALUE);
        List<ScreenText> texts = screenTextRepository
                .findByDescription_IdAndStartMsBetweenOrderByStartMsAsc(descriptionId, from, Integer.MAX_VALUE);
        List<SceneInfo> sceneInfos = scenes.stream().map(scene -> new SceneInfo(scene.getStartMs(), scene.getTitle(),
                scene.getSceneDescription(),
                lines.stream().filter(l -> inScene(l.getStartMs(), scene))
                        .map(l -> new Narration(l.getStartMs(), l.getText())).toList(),
                texts.stream().filter(t -> inScene(t.getStartMs(), scene)).map(AnswerContextReader::screenText)
                        .filter(t -> t != null && !t.isBlank()).distinct().toList())).toList();
        List<Dialogue> dialogues = transcriptSegmentRepository
                .findInRangeWithCharacter(descriptionId, from, Integer.MAX_VALUE).stream()
                .map(t -> new Dialogue(t.getStartMs(), t.getCharacter() == null ? null : t.getCharacter().getName(),
                        t.getText()))
                .toList();
        return Optional.of(new FutureContext(description.get().getSummaryText(), sceneInfos, dialogues));
    }

    /** 앞 장면과 지금 장면. 입력 시각이 첫 장면보다 앞이면 첫 장면만 */
    static List<Scene> pick(List<Scene> scenes, int nowMs) {
        int current = -1;
        for (int i = 0; i < scenes.size(); i++) {
            if (scenes.get(i).getStartMs() <= nowMs) {
                current = i;
            }
        }
        if (current < 0) {
            return scenes.isEmpty() ? List.of() : List.of(scenes.get(0));
        }
        return current == 0 ? List.of(scenes.get(0)) : List.of(scenes.get(current - 1), scenes.get(current));
    }

    private static boolean inScene(int ms, Scene scene) {
        return ms >= scene.getStartMs() && ms < scene.getEndMs();
    }

    private static String screenText(ScreenText text) {
        return text.getHeadline() != null ? text.getHeadline() : text.getFullText();
    }

    private static <T> List<T> last(List<T> values, int max) {
        return values.size() <= max ? values : new ArrayList<>(values.subList(values.size() - max, values.size()));
    }
}
