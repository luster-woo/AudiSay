package com.audisay.domain.description.service;

import com.audisay.domain.description.dto.response.DescriptionResponse;
import com.audisay.domain.description.dto.response.DialogueResponse;
import com.audisay.domain.description.dto.response.LineResponse;
import com.audisay.domain.description.dto.response.SceneResponse;
import com.audisay.domain.description.dto.response.ScreenTextResponse;
import com.audisay.domain.description.entity.Description;
import com.audisay.domain.description.entity.DescriptionStatus;
import com.audisay.domain.description.repository.DescriptionLineRepository;
import com.audisay.domain.description.repository.DescriptionRepository;
import com.audisay.domain.description.repository.SceneRepository;
import com.audisay.domain.description.repository.ScreenTextRepository;
import com.audisay.domain.description.repository.TranscriptSegmentRepository;
import com.audisay.domain.job.entity.JobStatus;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import com.audisay.global.external.s3.AudioUrlResolver;
import com.audisay.global.security.AuthUser;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class DescriptionService {
    private final VideoAccessValidator videoAccessValidator;
    private final DescriptionRepository descriptionRepository;
    private final DescriptionLineRepository descriptionLineRepository;
    private final SceneRepository sceneRepository;
    private final TranscriptSegmentRepository transcriptSegmentRepository;
    private final ScreenTextRepository screenTextRepository;
    private final AudioUrlResolver audioUrlResolver;

    public DescriptionResponse getDescription(AuthUser authUser, Long videoId) {
        videoAccessValidator.getAccessibleVideo(authUser, videoId);
        Description description = getPublishedDescription(videoId);
        Long descriptionId = description.getId();

        List<LineResponse> lines = descriptionLineRepository.findAllByDescriptionId(descriptionId).stream()
                .map(line -> LineResponse.of(line, audioUrlResolver.resolve(line.getAudioKey())))
                .toList();
        List<SceneResponse> scenes = sceneRepository.findByDescription_IdOrderBySceneIndexAsc(descriptionId).stream()
                .map(SceneResponse::from)
                .toList();
        List<DialogueResponse> dialogues = transcriptSegmentRepository.findAllWithCharacterByDescriptionId(descriptionId).stream()
                .map(DialogueResponse::from)
                .toList();
        List<ScreenTextResponse> screenTexts = screenTextRepository.findByDescription_IdOrderByStartMsAsc(descriptionId).stream()
                .map(ScreenTextResponse::from)
                .toList();

        return DescriptionResponse.of(description, videoId, getCoveredUntilMs(description),
                lines, scenes, dialogues, screenTexts);
    }

    private Description getPublishedDescription(Long videoId) {
        return descriptionRepository.findByVideo_IdAndStatus(videoId, DescriptionStatus.PUBLISHED)
                .orElseThrow(() -> new BusinessException(ErrorCode.DESCRIPTION_NOT_FOUND, "아직 해설이 없습니다."));
    }

    /**
     * PARTIAL이면 해설이 이어진 데까지의 시각, 아니면 null(전체 구간)
     */
    private Integer getCoveredUntilMs(Description description) {
        if (description.getJob().getStatus() != JobStatus.PARTIAL) {
            return null;
        }
        return descriptionRepository.findCoveredUntilMs(description.getJob().getId()).orElse(0);
    }
}
