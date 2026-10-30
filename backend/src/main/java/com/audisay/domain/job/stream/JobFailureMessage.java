package com.audisay.domain.job.stream;

import java.util.Map;

/** SSE failed 이벤트의 안내 문구. FE가 그대로 읽어 준다 */
final class JobFailureMessage {
    private static final String DEFAULT = "해설을 만들지 못했어요. 잠시 후 다시 요청해 주세요.";
    private static final Map<String, String> MESSAGES = Map.of(
            "VIDEO_UNAVAILABLE", "영상이 비공개로 바뀌어 해설을 만들 수 없어요.",
            "DURATION_MISMATCH", "영상 길이를 확인할 수 없어 해설을 만들 수 없어요.",
            "TRANSCODE_FAILED", "영상 파일을 변환하지 못해 해설을 만들 수 없어요.",
            "AI_LIMIT", "지금 요청이 많아 해설을 만들지 못했어요. 잠시 후 다시 요청해 주세요.",
            "AI_TIMEOUT", "해설을 만드는 데 시간이 너무 오래 걸렸어요. 다시 요청해 주세요."
    );

    private JobFailureMessage() {
    }

    static String of(String errorCode) {
        return MESSAGES.getOrDefault(errorCode, DEFAULT);
    }
}
