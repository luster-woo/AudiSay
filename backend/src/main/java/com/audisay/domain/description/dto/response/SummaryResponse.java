package com.audisay.domain.description.dto.response;

import com.audisay.domain.description.entity.Description;

public record SummaryResponse(
        Long descriptionId,
        Summary summary
) {
    public record Summary(
            String text,
            String audioUrl,
            Integer durationMs
    ) {
    }

    public static SummaryResponse of(Description description, String audioUrl) {
        return new SummaryResponse(
                description.getId(),
                new Summary(description.getSummaryText(), audioUrl, description.getSummaryDurationMs())
        );
    }
}
