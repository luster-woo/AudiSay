package com.audisay.domain.chat.search;

/**
 * 색인할 줄 하나. sourceType은 SCENE(scenes.scene_description) / NARRATION(description_lines) /
 * DIALOGUE(transcript_segments) / SCREEN(screen_texts, headline 없으면 full_text), sourceId는 그 행의 id
 */
public record SceneSourceLine(String sourceType, long sourceId, int startMs, String text) {
}
