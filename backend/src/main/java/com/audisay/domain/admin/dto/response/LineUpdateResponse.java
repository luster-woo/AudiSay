package com.audisay.domain.admin.dto.response;

import com.audisay.domain.description.entity.DescriptionLine;

import java.time.Instant;

/**
 * @param audioUrl         고친 직후라 항상 null. 음성은 워커가 만든 뒤 검수용 해설 조회로 확인한다
 * @param audioRegenerating 문장 글자가 바뀌어 음성을 다시 만드는 중이면 true. 중요도만 바꿨으면 false(음성 그대로)
 */
public record LineUpdateResponse(
        Long lineId,
        Long descriptionId,
        Integer detailLevel,
        Integer startMs,
        Integer importance,
        String text,
        String audioUrl,
        Instant updatedAt,
        boolean audioRegenerating
) {
    public static LineUpdateResponse from(DescriptionLine line, boolean audioRegenerating) {
        return new LineUpdateResponse(line.getId(), line.getDescription().getId(), line.getDetailLevel().intValue(),
                line.getStartMs(), line.getImportance().intValue(), line.getText(), null, line.getUpdatedAt(),
                audioRegenerating);
    }
}
