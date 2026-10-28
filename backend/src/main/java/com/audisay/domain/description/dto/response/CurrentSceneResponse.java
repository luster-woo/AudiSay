package com.audisay.domain.description.dto.response;

import com.audisay.domain.description.entity.Scene;

public record CurrentSceneResponse(
        Long sceneId,
        String title,
        Integer startMs,
        Integer endMs,
        String sceneDescription
) {
    public static CurrentSceneResponse from(Scene scene) {
        return new CurrentSceneResponse(
                scene.getId(),
                scene.getTitle(),
                scene.getStartMs(),
                scene.getEndMs(),
                scene.getSceneDescription()
        );
    }
}
