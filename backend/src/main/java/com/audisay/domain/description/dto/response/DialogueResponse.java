package com.audisay.domain.description.dto.response;

import com.audisay.domain.description.entity.TranscriptSegment;

public record DialogueResponse(
        Integer startMs,
        Integer endMs,
        String text,
        String characterName
) {
    public static DialogueResponse from(TranscriptSegment segment) {
        return new DialogueResponse(
                segment.getStartMs(),
                segment.getEndMs(),
                segment.getText(),
                segment.getCharacter() == null ? null : segment.getCharacter().getName()
        );
    }
}
