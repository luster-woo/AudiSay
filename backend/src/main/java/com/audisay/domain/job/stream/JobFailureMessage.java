package com.audisay.domain.job.stream;

import java.util.Map;

/** SSE failed 이벤트의 안내 문구 = API 명세 "작업 실패 원인 코드" 표 */
final class JobFailureMessage {
    private static final String DEFAULT = "알 수 없는 오류가 났어요.";
    private static final Map<String, String> MESSAGES = Map.of(
            "VIDEO_UNAVAILABLE", "영상이 비공개로 바뀌어 해설을 만들 수 없어요.",
            "DURATION_MISMATCH", "영상 길이가 올릴 때와 달라요.",
            "TRANSCODE_FAILED", "영상 파일을 읽을 수 없어요.",
            "AI_LIMIT", "지금 요청이 많아요. 잠시 후 다시 시도해 주세요.",
            "AI_TIMEOUT", "시간이 오래 걸려 멈췄어요. 다시 시도해 주세요."
    );

    private JobFailureMessage() {
    }

    static String of(String errorCode) {
        return MESSAGES.getOrDefault(errorCode, DEFAULT);
    }
}
