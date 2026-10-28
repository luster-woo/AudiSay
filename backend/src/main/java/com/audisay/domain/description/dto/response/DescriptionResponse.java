package com.audisay.domain.description.dto.response;

import com.audisay.domain.description.entity.Description;
import com.audisay.domain.description.entity.DescriptionStatus;

import java.time.Instant;
import java.util.List;

public record DescriptionResponse(
        Long descriptionId,
        Long videoId,
        DescriptionStatus status,
        Integer coveredUntilMs,
        Instant createdAt,
        List<LineResponse> lines,
        List<SceneResponse> scenes,
        List<DialogueResponse> dialogues,
        List<ScreenTextResponse> screenTexts
) {
    public static DescriptionResponse of(Description description,
                                         Long videoId,
                                         Integer coveredUntilMs,
                                         List<LineResponse> lines,
                                         List<SceneResponse> scenes,
                                         List<DialogueResponse> dialogues,
                                         List<ScreenTextResponse> screenTexts) {
        return new DescriptionResponse(
                description.getId(),
                videoId,
                description.getStatus(),
                coveredUntilMs,
                description.getCreatedAt(),
                lines,
                scenes,
                dialogues,
                screenTexts
        );
    }
}
