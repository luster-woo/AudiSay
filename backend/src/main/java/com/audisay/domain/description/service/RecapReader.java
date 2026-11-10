package com.audisay.domain.description.service;

import com.audisay.domain.description.entity.Chapter;
import com.audisay.domain.description.entity.Description;
import com.audisay.domain.description.entity.DescriptionLine;
import com.audisay.domain.description.repository.ChapterRepository;
import com.audisay.domain.description.repository.DescriptionLineRepository;
import com.audisay.domain.description.repository.DescriptionRepository;
import com.audisay.domain.description.repository.TranscriptSegmentRepository;
import com.audisay.domain.description.service.RecapContext.Part;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * 지금까지 줄거리 자료. 끝난 장면은 제목 + 목차 요약(장면 전체라 끝난 장면만), 지금 장면은 질문한 시각까지의 해설 문장만
 * (지금 장면 제목은 "반죽 짜고 냉동실에 굳히기"처럼 뒤 내용을 담을 수 있어 뺀다).
 * 전체 1.2만 자 안에 들게 장면마다 글자 수를 나눈다(60분 영상도 앞부분이 빠지지 않게)
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class RecapReader {
    static final int MAX_CHARS = 12_000;
    static final int MIN_PART_CHARS = 80;

    private final DescriptionRepository descriptionRepository;
    private final ChapterRepository chapterRepository;
    private final DescriptionLineRepository descriptionLineRepository;
    private final TranscriptSegmentRepository transcriptSegmentRepository;

    public Optional<RecapContext> read(Long descriptionId, int nowMs) {
        Optional<Description> description = descriptionRepository.findById(descriptionId);
        if (description.isEmpty()) {
            return Optional.empty();
        }
        int now = Math.max(0, nowMs);
        List<Chapter> chapters = chapterRepository.findByDescription_IdOrderByChapterIndexAsc(descriptionId).stream()
                .filter(c -> c.getStartMs() < now)
                .toList();
        List<Part> parts = new ArrayList<>();
        int perPart = chapters.isEmpty() ? MAX_CHARS : Math.max(MIN_PART_CHARS, MAX_CHARS / chapters.size());
        for (Chapter chapter : chapters) {
            if (chapter.getEndMs() <= now) {
                parts.add(new Part(chapter.getStartMs(), chapter.getTitle(), cut(chapter.getSummary(), perPart)));
            } else {
                // 외국어 대사를 읽어 주는 문장(DubLines)은 줄거리가 아니라 대사라 뺀다
                List<DescriptionLine> lines = DubLines.remove(
                        descriptionLineRepository.findInRange(descriptionId, chapter.getStartMs(), now),
                        transcriptSegmentRepository.findInRangeWithCharacter(descriptionId,
                                Math.max(0, chapter.getStartMs() - DubLines.LOOKBACK_MS), now));
                String text = lines.stream().map(DescriptionLine::getText).collect(Collectors.joining(" "));
                parts.add(new Part(chapter.getStartMs(), null, cut(text, perPart)));
            }
        }
        return Optional.of(new RecapContext(description.get().getVideo().getTitle(), now, parts));
    }

    private static String cut(String text, int max) {
        if (text == null || text.isBlank()) {
            return null;
        }
        String t = text.strip();
        return t.length() <= max ? t : t.substring(0, max) + "…";
    }
}
