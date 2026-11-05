package com.audisay.global.external.ocr;

public class OcrException extends RuntimeException {

    public enum Kind {
        /** 올린 파일을 이미지로 읽지 못함(깨진 파일, 암호 걸린 PDF 등) — 사용자 쪽 문제 */
        UNREADABLE_INPUT,
        /** 모델 로드·추론 실패, 대기 시간 초과 — 우리 쪽 문제 */
        ENGINE
    }

    private final Kind kind;

    public OcrException(Kind kind, String message) {
        super(message);
        this.kind = kind;
    }

    public OcrException(Kind kind, String message, Throwable cause) {
        super(message, cause);
        this.kind = kind;
    }

    public Kind kind() {
        return kind;
    }
}
