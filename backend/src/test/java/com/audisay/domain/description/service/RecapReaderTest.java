package com.audisay.domain.description.service;

import com.audisay.domain.description.entity.Chapter;
import com.audisay.domain.description.entity.Description;
import com.audisay.domain.description.entity.DescriptionLine;
import com.audisay.domain.description.repository.ChapterRepository;
import com.audisay.domain.description.repository.DescriptionLineRepository;
import com.audisay.domain.description.repository.DescriptionRepository;
import com.audisay.domain.video.entity.Video;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class RecapReaderTest {
    private static final long DESC = 9301L;

    private final DescriptionRepository descriptionRepository = mock(DescriptionRepository.class);
    private final ChapterRepository chapterRepository = mock(ChapterRepository.class);
    private final DescriptionLineRepository lineRepository = mock(DescriptionLineRepository.class);
    private final RecapReader reader = new RecapReader(descriptionRepository, chapterRepository, lineRepository);

    @BeforeEach
    void setUp() {
        Video video = mock(Video.class);
        when(video.getTitle()).thenReturn("두산 대 LG");
        Description description = mock(Description.class);
        when(description.getVideo()).thenReturn(video);
        when(descriptionRepository.findById(DESC)).thenReturn(Optional.of(description));
        List<Chapter> chapters = List.of(chapter(0, 60_000, "1회 초", "두산이 선취점을 냅니다."),
                chapter(60_000, 120_000, "1회 말", "LG가 동점을 만들고 역전합니다."),
                chapter(120_000, 180_000, "2회 초", "홈런이 나옵니다."));
        when(chapterRepository.findByDescription_IdOrderByChapterIndexAsc(DESC)).thenReturn(chapters);
    }

    @Test
    void 끝난_장면은_제목과_요약_지금_장면은_질문한_시각까지_문장만_뒤_장면은_뺀다() {
        List<DescriptionLine> lines = List.of(line("LG 타자가 섭니다"), line("안타를 칩니다"));
        when(lineRepository.findInRange(DESC, 60_000, 90_000)).thenReturn(lines);

        RecapContext recap = reader.read(DESC, 90_000).orElseThrow();

        assertThat(recap.videoTitle()).isEqualTo("두산 대 LG");
        assertThat(recap.parts()).extracting(RecapContext.Part::startMs).containsExactly(0, 60_000);
        assertThat(recap.parts()).extracting(RecapContext.Part::title).containsExactly("1회 초", null);
        assertThat(recap.parts().get(0).text()).isEqualTo("두산이 선취점을 냅니다.");
        assertThat(recap.parts().get(1).text()).isEqualTo("LG 타자가 섭니다 안타를 칩니다");
    }

    @Test
    void 첫_장면_전이면_지난_내용이_없다() {
        assertThat(reader.read(DESC, 0).orElseThrow().parts()).isEmpty();
        assertThat(reader.read(1L, 0)).isEmpty();
    }

    private static Chapter chapter(int start, int end, String title, String summary) {
        Chapter chapter = mock(Chapter.class);
        when(chapter.getStartMs()).thenReturn(start);
        when(chapter.getEndMs()).thenReturn(end);
        when(chapter.getTitle()).thenReturn(title);
        when(chapter.getSummary()).thenReturn(summary);
        return chapter;
    }

    private static DescriptionLine line(String text) {
        DescriptionLine line = mock(DescriptionLine.class);
        when(line.getText()).thenReturn(text);
        return line;
    }
}
