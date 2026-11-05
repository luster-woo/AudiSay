package com.audisay.global.external.ocr;

import ai.onnxruntime.OrtSession.SessionOptions.OptLevel;

import java.util.Arrays;
import java.util.List;

/**
 * ONNX Runtime 그래프 최적화 단계. 모델을 못 불러오거나 첫 추론이 실패하면 다음(낮은) 단계로 내린다.
 */
public enum OptimizationLevel {
    ALL(OptLevel.ALL_OPT),
    BASIC(OptLevel.BASIC_OPT),
    NONE(OptLevel.NO_OPT);

    private final OptLevel ortLevel;

    OptimizationLevel(OptLevel ortLevel) {
        this.ortLevel = ortLevel;
    }

    OptLevel ortLevel() {
        return ortLevel;
    }

    /** 이 단계부터 가장 낮은 단계까지 */
    List<OptimizationLevel> fromHere() {
        return Arrays.asList(values()).subList(ordinal(), values().length);
    }
}
