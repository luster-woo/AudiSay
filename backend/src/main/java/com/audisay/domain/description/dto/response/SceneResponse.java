package com.audisay.domain.description.dto.response;

import com.audisay.domain.description.entity.Scene;

public record SceneResponse(
        Long sceneId,
        Integer sceneIndex,
        String title,
        Integer startMs,
        Integer endMs
) {
    public static SceneResponse from(Scene scene) {
        return new SceneResponse(
                scene.getId(),
                scene.getSceneIndex(),
                scene.getTitle(),
                scene.getStartMs(),
                scene.getEndMs()
        );
    }
}
