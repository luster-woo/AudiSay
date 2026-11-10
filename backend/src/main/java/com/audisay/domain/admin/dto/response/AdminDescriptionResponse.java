package com.audisay.domain.admin.dto.response;

import com.audisay.domain.description.dto.response.DialogueResponse;
import com.audisay.domain.description.dto.response.ScreenTextResponse;
import com.audisay.domain.description.entity.Description;
import com.audisay.domain.description.entity.DescriptionLine;
import com.audisay.domain.description.entity.DescriptionStatus;
import com.audisay.domain.description.entity.Scene;

import java.time.Instant;
import java.util.List;

/**
 * 검수용 해설. 일반 해설 조회와 달리 장면 설명·대표 프레임, 문장별 신고 수, 해설 버전 목록을 준다.
 */
public record AdminDescriptionResponse(
        Long descriptionId,
        Long videoId,
        DescriptionStatus status,
        List<Version> versions,
        List<AdminScene> scenes,
        List<AdminLine> lines,
        List<DialogueResponse> dialogues,
        List<ScreenTextResponse> screenTexts
) {
    public record Version(Long descriptionId, DescriptionStatus status, Instant createdAt) {
        public static Version from(Description description) {
            return new Version(description.getId(), description.getStatus(), description.getCreatedAt());
        }
    }

    /**
     * @param keyframeUrl 대표 프레임 presigned 주소. 업로드 영상만 있고 유튜브 영상은 null
     */
    public record AdminScene(
            Long sceneId,
            Integer sceneIndex,
            String title,
            Integer startMs,
            Integer endMs,
            String sceneDescription,
            String keyframeUrl
    ) {
        public static AdminScene of(Scene scene, String keyframeUrl) {
            return new AdminScene(scene.getId(), scene.getSceneIndex(), scene.getTitle(), scene.getStartMs(),
                    scene.getEndMs(), scene.getSceneDescription(), keyframeUrl);
        }
    }

    /**
     * @param reportCount        처리 상태와 관계없이 이 문장에 들어온 신고 수
     * @param pendingReportCount 처리 전(PENDING) 신고 수
     */
    public record AdminLine(
            Long lineId,
            Integer lineIndex,
            Integer detailLevel,
            Integer startMs,
            Integer gapEndMs,
            Integer importance,
            String text,
            String lineType,
            String audioUrl,
            Integer audioDurationMs,
            long reportCount,
            long pendingReportCount,
            Instant updatedAt
    ) {
        public static AdminLine of(DescriptionLine line, String audioUrl, long reportCount, long pendingReportCount) {
            return new AdminLine(line.getId(), line.getLineIndex(), line.getDetailLevel().intValue(), line.getStartMs(),
                    line.getGapEndMs(), line.getImportance().intValue(), line.getText(), line.getLineType().name(), audioUrl,
                    line.getAudioDurationMs(), reportCount, pendingReportCount, line.getUpdatedAt());
        }
    }
}
