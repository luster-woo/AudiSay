package com.audisay.domain.description.service;

import com.audisay.domain.description.entity.Chapter;
import com.audisay.domain.description.entity.DescriptionLine;
import com.audisay.domain.description.entity.Scene;
import com.audisay.domain.description.entity.ScreenText;
import com.audisay.domain.description.entity.TranscriptSegment;
import com.audisay.domain.description.repository.ChapterRepository;
import com.audisay.domain.description.repository.DescriptionLineRepository;
import com.audisay.domain.description.repository.SceneRepository;
import com.audisay.domain.description.repository.ScreenTextRepository;
import com.audisay.domain.description.repository.TranscriptSegmentRepository;
import com.audisay.domain.description.service.SceneText.Moment;
import com.audisay.domain.description.service.SceneText.MomentType;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Collectors;

/**
 * 해설 하나의 목차마다 그 구간 [startMs, endMs)의 장면 설명과, 해설 문장·대사·화면 글자를 시각과 함께 묶는다.
 * 새로 저장하지 않고 요청마다 조립한다(해설 하나당 쿼리 5번)
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class SceneTextReader {
    private final ChapterRepository chapterRepository;
    private final SceneRepository sceneRepository;
    private final DescriptionLineRepository descriptionLineRepository;
    private final TranscriptSegmentRepository transcriptSegmentRepository;
    private final ScreenTextRepository screenTextRepository;

    public List<SceneText> read(Long descriptionId) {
        List<Chapter> chapters = chapterRepository.findByDescription_IdOrderByChapterIndexAsc(descriptionId);
        if (chapters.isEmpty()) {
            return List.of();
        }
        List<Scene> scenes = sceneRepository.findByDescription_IdOrderBySceneIndexAsc(descriptionId);
        List<Moment> moments = new ArrayList<>();
        for (DescriptionLine line : descriptionLineRepository.findAllByDescriptionId(descriptionId)) {
            moments.add(new Moment(line.getStartMs(), MomentType.NARRATION, line.getText()));
        }
        for (TranscriptSegment segment : transcriptSegmentRepository.findAllWithCharacterByDescriptionId(descriptionId)) {
            moments.add(new Moment(segment.getStartMs(), MomentType.DIALOGUE, segment.getText()));
        }
        for (ScreenText text : screenTextRepository.findByDescription_IdOrderByStartMsAsc(descriptionId)) {
            String value = text.getHeadline() != null ? text.getHeadline() : text.getFullText();
            if (value != null) {
                moments.add(new Moment(text.getStartMs(), MomentType.SCREEN, value));
            }
        }
        moments.sort(Comparator.comparingInt(Moment::startMs));

        return chapters.stream().map(chapter -> {
            int start = chapter.getStartMs();
            int end = chapter.getEndMs();
            String sceneDescription = scenes.stream()
                    .filter(s -> s.getStartMs() < end && s.getEndMs() > start)
                    .map(Scene::getSceneDescription)
                    .collect(Collectors.joining(" "));
            List<Moment> inChapter = moments.stream()
                    .filter(m -> m.startMs() >= start && m.startMs() < end)
                    .toList();
            return new SceneText(chapter.getId(), chapter.getChapterIndex(), start, end, chapter.getTitle(),
                    chapter.getSummary(), chapter.getKeywords() == null ? List.of() : chapter.getKeywords(),
                    sceneDescription, inChapter);
        }).toList();
    }
}
