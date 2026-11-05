package com.audisay.global.external.ocr;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

import java.time.Duration;

/**
 * 인증 서류 글자 읽기 설정 (application.yml의 audisay.ocr).
 *
 * @param modelDir          모델 폴더(실행 위치 기준). 로컬은 backend/models/ocr, 배포 이미지는 /app/models/ocr
 * @param minScore          이 점수 미만인 줄은 버린다(H200 /ocr와 같은 0.6)
 * @param maxConcurrent     동시에 돌리는 OCR 수(메모리·CPU 보호). 넘으면 wait-timeout까지 기다린다
 * @param optimizationLevel 시작 최적화 단계. 실패하면 자동으로 낮춘다
 */
@ConfigurationProperties("audisay.ocr")
public record OcrProperties(
        @DefaultValue("models/ocr") String modelDir,
        @DefaultValue("det_mobile.onnx") String detModel,
        @DefaultValue("rec.onnx") String recModel,
        @DefaultValue("dict.txt") String dictionary,
        @DefaultValue("960") int detLongSide,
        @DefaultValue("0.6") double minScore,
        @DefaultValue("2") int threads,
        @DefaultValue("1") int maxConcurrent,
        @DefaultValue("10s") Duration waitTimeout,
        @DefaultValue("ALL") OptimizationLevel optimizationLevel
) {
}
