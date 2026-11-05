package com.audisay.domain.description.service;

import com.audisay.domain.description.dto.response.ChapterResponse;
import com.audisay.domain.description.dto.response.CurrentSceneResponse;
import com.audisay.domain.description.dto.response.DescriptionResponse;
import com.audisay.domain.description.dto.response.DialogueResponse;
import com.audisay.domain.description.dto.response.LineResponse;
import com.audisay.domain.description.dto.response.SceneResponse;
import com.audisay.domain.description.dto.response.ScreenTextResponse;
import com.audisay.domain.description.dto.response.SummaryResponse;
import com.audisay.domain.description.entity.Description;
import com.audisay.domain.description.entity.DescriptionStatus;
import com.audisay.domain.description.repository.ChapterRepository;
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

import java.util.EnumSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class DescriptionService {
    /** 챗봇이 근거로 쓸 수 있는 해설(만드는 중·실패한 해설은 빼고) */
    private static final Set<DescriptionStatus> CHAT_READABLE = EnumSet.of(DescriptionStatus.PUBLISHED, DescriptionStatus.ARCHIVED);

    private final VideoAccessValidator videoAccessValidator;
    private final DescriptionRepository descriptionRepository;
    private final DescriptionLineRepository descriptionLineRepository;
    private final SceneRepository sceneRepository;
    private final TranscriptSegmentRepository transcriptSegmentRepository;
    private final ScreenTextRepository screenTextRepository;
    private final ChapterRepository chapterRepository;
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

    public SummaryResponse getSummary(AuthUser authUser, Long videoId) {
        videoAccessValidator.getAccessibleVideo(authUser, videoId);
        Description description = getPublishedDescription(videoId);
        return SummaryResponse.of(description, audioUrlResolver.resolve(description.getSummaryAudioKey()));
    }

    public ChapterResponse getChapters(AuthUser authUser, Long videoId) {
        videoAccessValidator.getAccessibleVideo(authUser, videoId);
        Description description = getPublishedDescription(videoId);
        return ChapterResponse.of(
                description.getId(),
                chapterRepository.findByDescription_IdOrderByChapterIndexAsc(description.getId())
        );
    }

    public CurrentSceneResponse getCurrentScene(AuthUser authUser, Long videoId, Integer ms) {
        videoAccessValidator.getAccessibleVideo(authUser, videoId);
        Description description = getPublishedDescription(videoId);
        return sceneRepository.findAtTime(description.getId(), ms)
                .map(CurrentSceneResponse::from)
                .orElseThrow(() -> new BusinessException(ErrorCode.DESCRIPTION_NOT_IN_RANGE));
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

    /** 지금 공개 중인 해설 ID(챗봇 입력 기록용). 없으면 empty */
    public Optional<Long> findPublishedId(Long videoId) {
        return descriptionRepository.findByVideo_IdAndStatus(videoId, DescriptionStatus.PUBLISHED).map(Description::getId);
    }

    /**
     * 챗봇 입력이 가리키는 해설. FE가 보낸 해설이 이 영상의 다 만든 해설이면 그대로(보는 중에 새 해설이 공개돼 ARCHIVED가 된 것도),
     * 없거나 다른 영상의 것이거나 만드는 중·실패한 해설이면 지금 공개 중인 해설
     */
    public Optional<Long> resolveForChat(Long videoId, Long requestedDescriptionId) {
        if (requestedDescriptionId != null && descriptionRepository.existsByIdAndVideo_IdAndStatusIn(
                requestedDescriptionId, videoId, CHAT_READABLE)) {
            return Optional.of(requestedDescriptionId);
        }
        return findPublishedId(videoId);
    }

    public Optional<Long> findIdByJobId(Long jobId) {
        return descriptionRepository.findByJob_Id(jobId).map(Description::getId);
    }

    /** 영상당 PUBLISHED는 하나뿐이라(uq_descriptions_published) 이전 해설을 먼저 ARCHIVED로 flush한다 */
    @Transactional
    public void publish(Long descriptionId) {
        Description description = descriptionRepository.findById(descriptionId)
                .orElseThrow(() -> new BusinessException(ErrorCode.DESCRIPTION_NOT_FOUND));
        if (description.getStatus() == DescriptionStatus.PUBLISHED) {
            return;
        }
        descriptionRepository.findByVideo_IdAndStatus(description.getVideo().getId(), DescriptionStatus.PUBLISHED)
                .ifPresent(previous -> {
                    previous.archive();
                    descriptionRepository.flush();
                });
        description.publish();
    }
}
