package com.audisay.domain.description.dto.response;

import com.audisay.domain.description.entity.Chapter;

import java.util.List;

public record ChapterResponse(
        Long descriptionId,
        List<ChapterItem> chapters
) {
    public record ChapterItem(
            Long chapterId,
            Integer chapterIndex,
            String title,
            Integer startMs,
            Integer endMs,
            String summary
    ) {
        public static ChapterItem from(Chapter chapter) {
            return new ChapterItem(
                    chapter.getId(),
                    chapter.getChapterIndex(),
                    chapter.getTitle(),
                    chapter.getStartMs(),
                    chapter.getEndMs(),
                    chapter.getSummary()
            );
        }
    }

    public static ChapterResponse of(Long descriptionId, List<Chapter> chapters) {
        return new ChapterResponse(descriptionId, chapters.stream().map(ChapterItem::from).toList());
    }
}