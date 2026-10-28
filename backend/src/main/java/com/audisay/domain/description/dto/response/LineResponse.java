package com.audisay.domain.description.dto.response;

import com.audisay.domain.description.entity.DescriptionLine;

public record LineResponse(
        Long lineId,
        Integer lineIndex,
        Integer detailLevel,
        Integer startMs,
        Integer gapEndMs,
        Integer importance,
        String text,
        String audioUrl,
        Integer audioDurationMs
) {
    public static LineResponse of(DescriptionLine line, String audioUrl) {
        return new LineResponse(
                line.getId(),
                line.getLineIndex(),
                line.getDetailLevel().intValue(),
                line.getStartMs(),
                line.getGapEndMs(),
                line.getImportance().intValue(),
                line.getText(),
                audioUrl,
                line.getAudioDurationMs()
        );
    }
}
