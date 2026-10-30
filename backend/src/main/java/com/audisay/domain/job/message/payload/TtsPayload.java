package com.audisay.domain.job.message.payload;

public record TtsPayload(Long descriptionId, String voiceCode) {
    private static final String VOICE_CODE = "ko-female-1";

    public static TtsPayload of(Long descriptionId) {
        return new TtsPayload(descriptionId, VOICE_CODE);
    }
}
