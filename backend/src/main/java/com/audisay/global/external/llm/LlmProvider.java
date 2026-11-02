package com.audisay.global.external.llm;

/**
 * 공급사별 실제 호출(GMS Gemini, 가짜). audisay.gms.mode로 하나만 등록된다. H200·다른 공급사도 이걸 구현한다.
 */
public interface LlmProvider {

    LlmResult generate(LlmRequest request, String model);

    LlmResult stream(LlmRequest request, String model, DeltaHandler handler);
}
