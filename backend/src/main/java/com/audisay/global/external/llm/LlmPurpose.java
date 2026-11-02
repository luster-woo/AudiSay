package com.audisay.global.external.llm;

import com.audisay.global.aicall.AiCallPurpose;

/**
 * 챗봇 LLM 호출 용도. 용도마다 모델·타임아웃·서킷 브레이커가 따로다.
 * ai_call_logs purpose CHECK에 SEEK이 없어 장면 찾기는 INTENT로 남긴다.
 */
public enum LlmPurpose {
    INTENT(AiCallPurpose.INTENT),
    SEEK(AiCallPurpose.INTENT),
    ANSWER(AiCallPurpose.QUESTION);

    private final AiCallPurpose logPurpose;

    LlmPurpose(AiCallPurpose logPurpose) {
        this.logPurpose = logPurpose;
    }

    public AiCallPurpose logPurpose() {
        return logPurpose;
    }
}
