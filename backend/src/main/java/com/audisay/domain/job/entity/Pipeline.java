package com.audisay.domain.job.entity;

/** 처리 경로. 유튜브는 URL을 Gemini에 넘기고(GEMINI_URL), 업로드는 S3 파일을 직접 분석한다(LOCAL) */
public enum Pipeline {
    GEMINI_URL,
    LOCAL
}
