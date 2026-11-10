package com.audisay.domain.video.service;

import com.audisay.domain.description.entity.Description;
import com.audisay.domain.description.entity.DescriptionStatus;
import com.audisay.domain.description.repository.DescriptionRepository;
import com.audisay.domain.job.entity.Job;
import com.audisay.domain.job.entity.JobStatus;
import com.audisay.domain.job.repository.JobRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 영상의 해설 상태를 작업(jobs)·해설(descriptions)에서 읽는다. 목록은 영상 수와 관계없이 쿼리 3번으로 끝난다.
 */
@Component
@RequiredArgsConstructor
public class DescriptionStateReader {
    private final DescriptionRepository descriptionRepository;
    private final JobRepository jobRepository;

    @Transactional(readOnly = true)
    public DescriptionState read(Long videoId) {
        return readAll(List.of(videoId)).get(videoId);
    }

    /**
     * 마지막 작업이 다시 해도 같은 이유로 실패할 오류(TRANSCODE_FAILED·DURATION_MISMATCH 등, Job.isRetryable)로 끝났으면 true.
     * VIDEO_UNAVAILABLE은 방금 유튜브에서 다시 확인해 볼 수 있으면(availabilityRechecked) 다시 할 수 있다고 본다
     */
    @Transactional(readOnly = true)
    public boolean latestFailureNotRetryable(Long videoId, boolean availabilityRechecked) {
        return jobRepository.findLatestByVideoIds(List.of(videoId)).stream()
                .findFirst()
                .filter(job -> Boolean.FALSE.equals(job.isRetryable()))
                .filter(job -> !(availabilityRechecked && "VIDEO_UNAVAILABLE".equals(job.getErrorCode())))
                .isPresent();
    }

    /**
     * 공개 해설이 있으면 READY, 진행 중 작업이 있으면 GENERATING, 마지막 작업이 실패했으면 FAILED, 그 밖은 NONE.
     * 모든 영상 ID가 결과에 들어 있다.
     */
    @Transactional(readOnly = true)
    public Map<Long, DescriptionState> readAll(Collection<Long> videoIds) {
        Map<Long, DescriptionState> states = new HashMap<>();
        if (videoIds.isEmpty()) {
            return states;
        }

        Map<Long, Long> publishedIds = descriptionRepository
                .findByVideo_IdInAndStatus(videoIds, DescriptionStatus.PUBLISHED).stream()
                .collect(Collectors.toMap(d -> d.getVideo().getId(), Description::getId));
        Map<Long, Long> activeJobIds = jobRepository
                .findByVideo_IdInAndStatusIn(videoIds, JobStatus.ACTIVE).stream()
                .collect(Collectors.toMap(j -> j.getVideo().getId(), Job::getId));
        Map<Long, JobStatus> latestJobStatuses = jobRepository.findLatestByVideoIds(videoIds).stream()
                .collect(Collectors.toMap(j -> j.getVideo().getId(), Job::getStatus));

        for (Long videoId : videoIds) {
            Long descriptionId = publishedIds.get(videoId);
            Long activeJobId = activeJobIds.get(videoId);
            VideoDescriptionStatus status;
            if (descriptionId != null) {
                status = VideoDescriptionStatus.READY;
            } else if (activeJobId != null) {
                status = VideoDescriptionStatus.GENERATING;
            } else if (latestJobStatuses.get(videoId) == JobStatus.FAILED) {
                status = VideoDescriptionStatus.FAILED;
            } else {
                status = VideoDescriptionStatus.NONE;
            }
            states.put(videoId, new DescriptionState(status, descriptionId, activeJobId));
        }
        return states;
    }
}
