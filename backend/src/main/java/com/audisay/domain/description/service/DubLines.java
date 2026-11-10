package com.audisay.domain.description.service;

import com.audisay.domain.description.entity.DescriptionLine;
import com.audisay.domain.description.entity.TranscriptSegment;

import java.util.List;
import java.util.regex.Pattern;

/**
 * 외국어 대사를 한국어로 읽어 주는 문장 가르기. AI(375, describe.dub_lines)가 유튜브 외국어 대사의 한국어 번역을
 * 대사 시각에 읽어 주려고 description_lines에 상세도 1 문장("태웅: 금일 5월 15일.")으로 넣는다. 같은 번역은
 * transcript_segments에도 대사 글로 들어 있다. 이 문장의 표시(flags DIALOGUE_DUB)는 DB에 저장되지 않아 글로 가른다.
 * <p>
 * 챗봇은 description_lines를 "화면 해설"로 읽으므로(장면 찾기 근거 종류, 지금 장면 해설 12줄, 지난 줄거리, 색인)
 * 이 문장을 빼고, 대사는 대사로만 본다. 플레이어(해설 읽기)는 그대로 읽는다.
 * <p>
 * 기준: 상세도 1이고, 앞의 "이름: "을 뗀 글이(공백 무시) 그 시각에 들리는 대사 글 안에 그대로 있다.
 * 긴 번역은 문장별로 나뉘고 앞 문장을 읽느라 뒤로 밀리기도 해서(describe.spread) 대사 시작 ~ 대사 끝 + 15초로 본다
 */
public final class DubLines {
    /** 이 앞에서 시작한 대사까지 읽어 와야 대사 중간에 나뉜 번역 문장을 가를 수 있다(긴 연설 한 줄) */
    public static final int LOOKBACK_MS = 120_000;
    static final int AFTER_END_MS = 15_000;
    static final int MIN_CHARS = 2;
    private static final Pattern SPEAKER = Pattern.compile("^[^:\\s][^:]{0,29}:\\s+");
    private static final Pattern SPACE = Pattern.compile("\\s+");

    private DubLines() {
    }

    /** 대사 한 줄. text는 공백을 뺀 글 */
    public record Spoken(int startMs, int endMs, String text) {
        public Spoken {
            text = text == null ? null : compact(text);
        }

        public static Spoken of(TranscriptSegment t) {
            return new Spoken(t.getStartMs(), t.getEndMs() == null ? t.getStartMs() : t.getEndMs(), t.getText());
        }
    }

    /** 대사 번역을 읽어 주는 문장이면 true */
    public static boolean isDub(int startMs, int detailLevel, String text, List<Spoken> dialogues) {
        if (detailLevel != 1 || text == null || dialogues.isEmpty()) {
            return false;
        }
        String body = compact(SPEAKER.matcher(text.strip()).replaceFirst(""));
        if (body.length() < MIN_CHARS) {
            return false;
        }
        for (Spoken d : dialogues) {
            if (d.text() != null && d.startMs() <= startMs && startMs <= d.endMs() + AFTER_END_MS
                    && d.text().contains(body)) {
                return true;
            }
        }
        return false;
    }

    /** lines에서 대사 번역 문장을 뺀다. dialogues는 lines보다 LOOKBACK_MS 앞부터 읽은 대사 */
    public static List<DescriptionLine> remove(List<DescriptionLine> lines, List<TranscriptSegment> dialogues) {
        if (lines.isEmpty() || dialogues.isEmpty()) {
            return lines;
        }
        List<Spoken> spoken = dialogues.stream().map(Spoken::of).toList();
        return lines.stream()
                .filter(l -> l.getStartMs() == null
                        || !isDub(l.getStartMs(), l.getDetailLevel() == null ? 0 : l.getDetailLevel(), l.getText(), spoken))
                .toList();
    }

    private static String compact(String text) {
        return SPACE.matcher(text).replaceAll("");
    }
}
