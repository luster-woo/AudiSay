package com.audisay.domain.job.stream;

import java.util.Map;

/**
 * 작업 실패 원인 코드 → 사용자 안내 문구 (API 명세 "작업 실패 원인 코드" 표).
 * SSE failed 이벤트와 작업 상태 조회(errorMessage)가 같이 쓰고, 프론트는 이 문구를 그대로 보여 준다
 * (2026-11-10 점검: 같은 표를 프론트에도 따로 두어 문구가 서로 달랐다)
 */
public final class JobFailureMessage {
    private static final String DEFAULT = "알 수 없는 오류가 났어요.";
    private static final Map<String, String> MESSAGES = Map.of(
            "VIDEO_UNAVAILABLE", "영상이 비공개로 바뀌어 해설을 만들 수 없어요.",
            "DURATION_MISMATCH", "영상 길이를 확인할 수 없거나 올릴 수 있는 길이를 넘었어요.",
            "TRANSCODE_FAILED", "영상 파일을 읽을 수 없어요.",
            "AI_LIMIT", "지금 요청이 많아요. 잠시 뒤에 다시 시도해 주세요.",
            "AI_TIMEOUT", "시간이 오래 걸려 멈췄어요. 다시 시도해 주세요."
    );

    private JobFailureMessage() {
    }

    public static String of(String errorCode) {
        return MESSAGES.getOrDefault(errorCode, DEFAULT);
    }
}
