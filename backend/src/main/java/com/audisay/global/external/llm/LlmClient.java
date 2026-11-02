package com.audisay.global.external.llm;

/**
 * 챗봇이 쓰는 LLM 호출. 용도별 모델·타임아웃·서킷 브레이커와 ai_call_logs 기록은 구현이 맡는다.
 * 실패는 {@link LlmException}.
 */
public interface LlmClient {

    LlmResult generate(LlmRequest request);

    /** 조각마다 handler를 부르고, 끝나면 전체 결과를 돌려준다(블로킹) */
    LlmResult stream(LlmRequest request, DeltaHandler handler);
}
