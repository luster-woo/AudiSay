package com.audisay.domain.description.dto.response;

import com.audisay.domain.description.entity.ScreenText;
import com.audisay.domain.description.entity.ScreenTextImportance;
import com.audisay.domain.description.entity.ScreenTextType;

public record ScreenTextResponse(
        Long screenTextId,
        Integer startMs,
        Integer endMs,
        ScreenTextType textType,
        ScreenTextImportance importance,
        String headline,
        String fullText,
        String summaryText,
        Boolean sameAsDialogue
) {
    public static ScreenTextResponse from(ScreenText screenText) {
        return new ScreenTextResponse(
                screenText.getId(),
                screenText.getStartMs(),
                screenText.getEndMs(),
                screenText.getTextType(),
                screenText.getImportance(),
                screenText.getHeadline(),
                screenText.getFullText(),
                screenText.getSummaryText(),
                screenText.getSameAsDialogue()
        );
    }
}
