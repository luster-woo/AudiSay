package com.audisay.domain.chat.dto.response;

import com.audisay.domain.chat.intent.ActionCode;
import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;

/**
 * intent마다 쓰는 칸만 내려간다(null은 응답에서 빠짐).
 * QUESTION·SCENE_NOW answerStreamUrl / SEEK_TIME targetMs / SEEK_SCENE targetMs·chapterId·candidates /
 * SETTING settingKey·settingValue(범위 끝이면 message) / ACTION actionCode / SEARCH_VIDEO query / UNKNOWN message
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ChatResult(String answerStreamUrl, Integer targetMs, Long chapterId, List<SceneCandidate> candidates,
                         String settingKey, String settingValue, ActionCode actionCode, String query, String message) {

    public static ChatResult answerStream(Long chatLogId) {
        return new ChatResult("/api/v1/chat/messages/" + chatLogId + "/stream", null, null, null, null, null, null, null, null);
    }

    public static ChatResult seekTime(Integer targetMs) {
        return new ChatResult(null, targetMs, null, null, null, null, null, null, null);
    }

    public static ChatResult seekScene(Integer targetMs, Long chapterId, List<SceneCandidate> candidates, String message) {
        return new ChatResult(null, targetMs, chapterId, candidates, null, null, null, null, message);
    }

    public static ChatResult setting(String settingKey, String settingValue, String message) {
        return new ChatResult(null, null, null, null, settingKey, settingValue, null, null, message);
    }

    public static ChatResult action(ActionCode actionCode) {
        return new ChatResult(null, null, null, null, null, null, actionCode, null, null);
    }

    public static ChatResult searchVideo(String query) {
        return new ChatResult(null, null, null, null, null, null, null, query, null);
    }

    public static ChatResult message(String message) {
        return new ChatResult(null, null, null, null, null, null, null, null, message);
    }

    /** SEEK_SCENE 후보 장면 */
    public record SceneCandidate(Long chapterId, String title, Integer startMs, String summary) {
    }
}
