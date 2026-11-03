package com.audisay.global.external.llm;

@FunctionalInterface
public interface DeltaHandler {

    /** 스트리밍 글자 조각. false를 돌려주면 스트림을 멈춘다(사용자가 답변을 닫음 등) */
    boolean onDelta(String text);
}
