package com.audisay.global.external.ocr;

/** 글자 한 줄과 인식 점수(0~1, 글자마다 확률의 평균) */
public record OcrLine(String text, double score) {
}
