package com.audisay.global.aicall;

/** ai_call_logs.purpose (DB CHECK 값 그대로). 해설 생성은 워커, STT·TTS는 AI 서버, 챗봇 LLM·인증 서류 OCR(VERIFY)은 Spring이 남긴다 */
public enum AiCallPurpose {
    STT, DESCRIBE, SHORTEN, SUMMARY, CHAPTER, CLASSIFY, QUESTION, INTENT, TTS, VERIFY, EMBED
}
