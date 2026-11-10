package com.audisay.domain.admin.service;

import com.audisay.domain.admin.dto.request.LineUpdateRequest;
import com.audisay.domain.admin.dto.response.AdminDescriptionResponse;
import com.audisay.domain.admin.dto.response.AdminDescriptionResponse.AdminLine;
import com.audisay.domain.admin.dto.response.AdminDescriptionResponse.AdminScene;
import com.audisay.domain.admin.dto.response.AdminDescriptionResponse.Version;
import com.audisay.domain.admin.dto.response.LineAudioResponse;
import com.audisay.domain.admin.dto.response.LineUpdateResponse;
import com.audisay.domain.description.dto.response.DialogueResponse;
import com.audisay.domain.description.dto.response.ScreenTextResponse;
import com.audisay.domain.description.entity.Description;
import com.audisay.domain.description.entity.DescriptionLine;
import com.audisay.domain.description.entity.DescriptionStatus;
import com.audisay.domain.description.repository.DescriptionLineRepository;
import com.audisay.domain.description.repository.DescriptionRepository;
import com.audisay.domain.description.repository.SceneRepository;
import com.audisay.domain.description.repository.ScreenTextRepository;
import com.audisay.domain.description.repository.TranscriptSegmentRepository;
import com.audisay.domain.job.message.MessageType;
import com.audisay.domain.job.message.payload.LineTtsPayload;
import com.audisay.domain.job.service.JobMessagePublisher;
import com.audisay.domain.report.repository.LineReportCount;
import com.audisay.domain.report.repository.ReportRepository;
import com.audisay.domain.video.repository.VideoRepository;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import com.audisay.global.external.s3.AudioUrlResolver;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 관리자 해설 검수. 해설 문장을 고치거나 음성만 다시 만들면 음성을 비우고 line.tts로 워커에 맡긴다.
 */
@Service
@RequiredArgsConstructor
public class AdminDescriptionService {
    private static final LineReportCount NO_REPORT = new LineReportCount(null, 0L, 0L);

    private final VideoRepository videoRepository;
    private final DescriptionRepository descriptionRepository;
    private final DescriptionLineRepository descriptionLineRepository;
    private final SceneRepository sceneRepository;
    private final TranscriptSegmentRepository transcriptSegmentRepository;
    private final ScreenTextRepository screenTextRepository;
    private final ReportRepository reportRepository;
    private final AudioUrlResolver audioUrlResolver;
    private final JobMessagePublisher jobMessagePublisher;

    /**
     * descriptionId가 없으면 공개 해설을, 공개 해설이 없으면 가장 최근 버전을 준다.
     * reportedOnly면 처리 전 신고가 있는 문장만 주고, 장면·대사·화면 글자는 그대로 전부 준다.
     */
    @Transactional(readOnly = true)
    public AdminDescriptionResponse getDescription(Long videoId, Long descriptionId, boolean reportedOnly) {
        if (!videoRepository.existsById(videoId)) {
            throw new BusinessException(ErrorCode.VIDEO_NOT_FOUND);
        }
        List<Description> versions = descriptionRepository.findByVideo_IdOrderByCreatedAtDescIdDesc(videoId);
        Description description = select(versions, descriptionId);
        Long id = description.getId();

        Map<Long, LineReportCount> reportCounts = reportRepository.countByLine(id).stream()
                .collect(Collectors.toMap(LineReportCount::lineId, Function.identity()));
        List<AdminLine> lines = descriptionLineRepository.findAllByDescriptionId(id).stream()
                .filter(line -> !reportedOnly || reportCounts.getOrDefault(line.getId(), NO_REPORT).pending() > 0)
                .map(line -> {
                    LineReportCount count = reportCounts.getOrDefault(line.getId(), NO_REPORT);
                    return AdminLine.of(line, audioUrlResolver.resolve(line.getAudioKey()), count.total(), count.pending());
                })
                .toList();
        List<AdminScene> scenes = sceneRepository.findByDescription_IdOrderBySceneIndexAsc(id).stream()
                .map(scene -> AdminScene.of(scene, audioUrlResolver.resolve(scene.getKeyframeKey())))
                .toList();
        List<DialogueResponse> dialogues = transcriptSegmentRepository.findAllWithCharacterByDescriptionId(id).stream()
                .map(DialogueResponse::from)
                .toList();
        List<ScreenTextResponse> screenTexts = screenTextRepository.findByDescription_IdOrderByStartMsAsc(id).stream()
                .map(ScreenTextResponse::from)
                .toList();

        return new AdminDescriptionResponse(id, videoId, description.getStatus(),
                versions.stream().map(Version::from).toList(), scenes, lines, dialogues, screenTexts);
    }

    /** 다음 재생부터 반영된다. 새 음성이 나올 때까지 플레이어는 브라우저 음성으로 읽는다 */
    @Transactional
    public LineUpdateResponse editLine(Long lineId, LineUpdateRequest request) {
        DescriptionLine line = getLine(lineId);
        // 중요도만 바꿨으면 음성을 지우거나 다시 만들지 않는다 (사용자는 계속 녹음 음성으로 듣고, TTS 비용도 들지 않는다)
        boolean textChanged = line.edit(request.text().strip(), request.importanceOrNull());
        // 응답의 updatedAt이 바뀐 값이 되도록 먼저 반영한다
        descriptionLineRepository.flush();
        if (textChanged) {
            requestAudio(line);
        }
        return LineUpdateResponse.from(line, textChanged);
    }

    /** 워커는 음성이 비어 있는 문장만 만들어서, 기존 음성을 비우고 넣는다 */
    @Transactional
    public LineAudioResponse regenerateAudio(Long lineId) {
        DescriptionLine line = getLine(lineId);
        line.clearAudio();
        requestAudio(line);
        return new LineAudioResponse(lineId, true);
    }

    private DescriptionLine getLine(Long lineId) {
        return descriptionLineRepository.findById(lineId)
                .orElseThrow(() -> new BusinessException(ErrorCode.DESCRIPTION_LINE_NOT_FOUND));
    }

    private void requestAudio(DescriptionLine line) {
        jobMessagePublisher.publish(null, MessageType.LINE_TTS,
                LineTtsPayload.line(line.getDescription().getId(), line.getId()));
    }

    private static Description select(List<Description> versions, Long descriptionId) {
        Optional<Description> selected = descriptionId != null
                ? versions.stream().filter(d -> d.getId().equals(descriptionId)).findFirst()
                : versions.stream().filter(d -> d.getStatus() == DescriptionStatus.PUBLISHED).findFirst()
                .or(() -> versions.stream().findFirst());
        return selected.orElseThrow(() -> new BusinessException(ErrorCode.DESCRIPTION_NOT_FOUND));
    }
}
