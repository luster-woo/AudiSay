package com.audisay.domain.job.message.payload;

import java.util.List;

/**
 * line.tts. 작업과 상관없는 단독 메시지(jobId null)다. 워커는 lineIds가 있으면 그 문장 중, 없으면 detailLevel 문장 중
 * 음성(audio_key)이 비어 있는 문장만 만든다.
 */
public record LineTtsPayload(Long descriptionId, List<Long> lineIds, Integer detailLevel) {

    /** 관리자가 고친 문장 하나 */
    public static LineTtsPayload line(Long descriptionId, Long lineId) {
        return new LineTtsPayload(descriptionId, List.of(lineId), null);
    }
}
