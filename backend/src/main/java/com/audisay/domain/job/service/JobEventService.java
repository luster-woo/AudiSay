package com.audisay.domain.job.service;

import com.audisay.domain.description.service.DescriptionService;
import com.audisay.domain.job.dto.JobProgress;
import com.audisay.domain.job.entity.Job;
import com.audisay.domain.job.entity.JobChunk;
import com.audisay.domain.job.entity.JobChunkStatus;
import com.audisay.domain.job.entity.JobStage;
import com.audisay.domain.job.entity.JobStatus;
import com.audisay.domain.job.entity.Pipeline;
import com.audisay.domain.job.message.JobEvent;
import com.audisay.domain.job.message.JobMessage;
import com.audisay.domain.job.message.MessageType;
import com.audisay.domain.job.message.payload.DescribePayload;
import com.audisay.domain.job.message.payload.MergePayload;
import com.audisay.domain.job.message.payload.TtsPayload;
import com.audisay.domain.job.message.result.MergeResult;
import com.audisay.domain.job.message.result.PrepareResult;
import com.audisay.domain.job.message.result.TtsResult;
import com.audisay.domain.job.repository.JobChunkRepository;
import com.audisay.domain.job.repository.JobRepository;
import com.audisay.domain.upload.service.UploadService;
import com.audisay.domain.video.entity.Category;
import com.audisay.domain.video.entity.Video;
import com.audisay.global.config.JobProperties;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.stream.Stream;

@Slf4j
@Service
@RequiredArgsConstructor
public class JobEventService {
    private static final int PREPARE_END = 20;
    private static final int DESCRIBE_END = 70;
    private static final int MERGE_END = 80;
    private static final String UNKNOWN_ERROR = "UNKNOWN";
    private static final String STALE_ERROR = "AI_TIMEOUT";
    private static final String TRANSCODE_FAILED = "TRANSCODE_FAILED";
    private static final String YOUTUBE_WATCH_URL = "https://www.youtube.com/watch?v=";

    private final JobRepository jobRepository;
    private final JobChunkRepository jobChunkRepository;
    private final JobMessagePublisher jobMessagePublisher;
    private final JobProgressNotifier notifier;
    private final JobProgressStore progressStore;
    private final JobEventDeduplicator deduplicator;
    private final DescriptionService descriptionService;
    private final UploadService uploadService;
    private final JobProperties jobProperties;
    private final ObjectMapper objectMapper;
    private final MeterRegistry meterRegistry;

    @Transactional
    public void handle(JobMessage envelope, JobEvent event) {
        deduplicator.markProcessedAfterCommit(envelope.messageId());
        Job job = jobRepository.findByIdForUpdate(envelope.jobId()).orElse(null);
        if (job == null) {
            log.warn("없는 작업의 이벤트 jobId={} event={}", envelope.jobId(), event.event());
            return;
        }
        if (job.isFinished()) {
            log.info("끝난 작업의 이벤트 무시 jobId={} status={} event={}", job.getId(), job.getStatus(), event.event());
            return;
        }
        switch (event.event()) {
            case STAGE_STARTED -> onStageStarted(job, event);
            case PROGRESS -> onProgress(job, event);
            case CHUNK_SUCCEEDED -> onChunkSucceeded(job, envelope, event);
            case STAGE_COMPLETED -> onStageCompleted(job, event);
            case FAILED -> onFailed(job, envelope, event);
        }
    }

    /** 워커가 3번 시도해도 실패한 메시지(job.dlq) */
    @Transactional
    public void handleDeadLetter(JobMessage envelope) {
        deduplicator.markProcessedAfterCommit(envelope.messageId());
        String errorCode = lastError(envelope, "errorCode", UNKNOWN_ERROR);
        String errorDetail = lastError(envelope, "errorDetail", null);
        log.warn("DLQ 메시지 type={} jobId={} attempt={} code={} detail={}",
                envelope.type(), envelope.jobId(), envelope.attempt(), errorCode, errorDetail);
        if (envelope.jobId() == null) {
            return;
        }
        Job job = jobRepository.findByIdForUpdate(envelope.jobId()).orElse(null);
        if (job == null || job.isFinished()) {
            return;
        }
        switch (envelope.type()) {
            case JOB_DESCRIBE -> {
                DescribePayload payload = objectMapper.convertValue(envelope.payload(), DescribePayload.class);
                JobChunk chunk = findChunk(job, payload.chunkIndex());
                if (chunk == null || chunk.getStatus().isFinished()) {
                    return;
                }
                chunk.markDead(envelope.attempt(), errorCode, errorDetail);
                // FAILED 이벤트와 같게: 조각 실패를 PARTIAL로 넘기지 않는 설정이면 작업 전체를 실패로
                if (jobProperties.partialOnChunkFailure()) {
                    afterChunkFinished(job);
                } else {
                    failJob(job, errorCode);
                }
            }
            case JOB_TTS -> onTtsCompleted(job, objectMapper.convertValue(envelope.payload(), TtsResult.class));
            case JOB_PREPARE, JOB_MERGE -> failJob(job, errorCode);
            case LINE_TTS, JOB_EVENT -> {
            }
        }
    }

    /**
     * 멈춘 작업 정리(StaleJobCleaner). 잠근 뒤 마지막 활동(대기 시작·시작·조각 갱신·Redis 진행 상태)을 다시 보고,
     * 그 사이 소식이 왔으면 건너뛴다. Redis를 못 읽으면 예외로 이번 주기는 건너뛴다
     *
     * @return FAILED로 바꿨으면 true
     */
    @Transactional
    public boolean failIfStale(Long jobId, Instant queuedBefore, Instant runningBefore) {
        Job job = jobRepository.findByIdForUpdate(jobId).orElse(null);
        if (job == null || job.isFinished()) {
            return false;
        }
        Instant lastActivity = Stream.of(
                        job.getQueuedAt(),
                        job.getStartedAt(),
                        jobChunkRepository.findLastUpdatedAt(jobId),
                        progressStore.find(jobId).map(JobProgress::updatedAt).orElse(null))
                .filter(Objects::nonNull)
                .max(Comparator.naturalOrder())
                .orElseThrow();
        Instant before = mayBeSilentLong(job) ? queuedBefore : runningBefore;
        if (!lastActivity.isBefore(before)) {
            return false;
        }
        log.warn("멈춘 작업 FAILED jobId={} status={} stage={} lastActivity={}",
                jobId, job.getStatus(), job.getCurrentStage(), lastActivity);
        meterRegistry.counter("audisay.job.stale", "status", job.getStatus().name(),
                "stage", job.getCurrentStage() == null ? "NONE" : job.getCurrentStage().name()).increment();
        failJob(job, STALE_ERROR);
        return true;
    }

    /**
     * 소식 없이 오래 걸릴 수 있는 작업은 대기 기준(queued-timeout)으로 본다.
     * - 워커 차례를 기다리는 중: 아직 안 끝난 조각(PENDING)은 처리 중인지 대기열에 있는지 알 수 없다(조각 시작 알림이 없다)
     * - 업로드(LOCAL) 영상 분석(PREPARE): 영상 길이의 약 1.4배(60분 영상 약 84분)라 진행 알림 사이가 길 수 있다
     */
    private boolean mayBeSilentLong(Job job) {
        return job.getStatus() == JobStatus.QUEUED
                || (job.getPipeline() == Pipeline.LOCAL && job.getCurrentStage() == JobStage.PREPARE)
                || jobChunkRepository.existsByJob_IdAndStatus(job.getId(), JobChunkStatus.PENDING);
    }

    private void onStageStarted(Job job, JobEvent event) {
        job.startStage(event.stage());
        notifier.progress(job);
    }

    private void onProgress(Job job, JobEvent event) {
        if (event.progress() == null) {
            return;
        }
        notifier.progress(job, Math.max(job.getProgress(), event.progress()));
    }

    private void onChunkSucceeded(Job job, JobMessage envelope, JobEvent event) {
        JobChunk chunk = findChunk(job, event.chunkIndex());
        if (chunk == null || chunk.getStatus().isFinished()) {
            return;
        }
        chunk.succeed(envelope.attempt(), event.workerId());
        afterChunkFinished(job);
    }

    private void onFailed(Job job, JobMessage envelope, JobEvent event) {
        log.warn("job 실패 이벤트 jobId={} stage={} chunk={} code={} detail={}",
                job.getId(), event.stage(), event.chunkIndex(), event.errorCode(), event.errorDetail());
        if (event.stage() == JobStage.DESCRIBE && event.chunkIndex() != null && jobProperties.partialOnChunkFailure()) {
            JobChunk chunk = findChunk(job, event.chunkIndex());
            if (chunk == null || chunk.getStatus().isFinished()) {
                return;
            }
            chunk.fail(envelope.attempt(), event.workerId(), event.errorCode(), event.errorDetail());
            afterChunkFinished(job);
            return;
        }
        failJob(job, event.errorCode());
    }

    private void onStageCompleted(Job job, JobEvent event) {
        if (event.result() == null && event.stage() != JobStage.DESCRIBE) {
            log.error("STAGE_COMPLETED에 result 없음 jobId={} stage={}", job.getId(), event.stage());
            return;
        }
        switch (event.stage()) {
            case PREPARE -> onPrepareCompleted(job, objectMapper.convertValue(event.result(), PrepareResult.class));
            case MERGE -> onMergeCompleted(job, objectMapper.convertValue(event.result(), MergeResult.class));
            case TTS -> onTtsCompleted(job, objectMapper.convertValue(event.result(), TtsResult.class));
            case DESCRIBE -> {
            }
        }
    }

    private void onPrepareCompleted(Job job, PrepareResult result) {
        if (jobChunkRepository.existsByJob_Id(job.getId())) {
            return;
        }
        Video video = job.getVideo();
        Category category = toCategory(result.category());
        video.changeCategory(category);
        String youtubeUrl = null;
        if (job.getPipeline() == Pipeline.LOCAL) {
            if (result.playbackKey() == null) {
                log.error("LOCAL prepare 결과에 playbackKey 없음 jobId={}", job.getId());
                failJob(job, TRANSCODE_FAILED);
                return;
            }
            uploadService.finishTranscode(video.getId(), result.playbackKey());
        } else {
            youtubeUrl = YOUTUBE_WATCH_URL + video.getYoutubeVideoId();
        }

        List<JobChunk> chunks = jobChunkRepository.saveAll(result.chunks().stream()
                .map(c -> JobChunk.create(job, c.chunkIndex(), c.startMs(), c.endMs(), c.contextSummary()))
                .toList());
        for (JobChunk chunk : chunks) {
            jobMessagePublisher.publish(job.getId(), MessageType.JOB_DESCRIBE,
                    DescribePayload.of(chunk, job.getPipeline(), youtubeUrl, category.name()));
        }
        job.updateProgress(PREPARE_END);
        notifier.progress(job);
    }

    private void afterChunkFinished(Job job) {
        List<JobChunk> chunks = jobChunkRepository.findByJob_IdOrderByChunkIndexAsc(job.getId());
        long finished = chunks.stream().filter(c -> c.getStatus().isFinished()).count();
        job.updateProgress((int) (PREPARE_END + (DESCRIBE_END - PREPARE_END) * finished / chunks.size()));
        if (finished < chunks.size()) {
            notifier.progress(job);
            return;
        }

        List<Integer> covered = ChunkCoverage.succeededPrefix(chunks);
        if (covered.isEmpty()) {
            String errorCode = chunks.getFirst().getErrorCode();
            failJob(job, errorCode == null ? UNKNOWN_ERROR : errorCode);
            return;
        }
        jobMessagePublisher.publish(job.getId(), MessageType.JOB_MERGE, MergePayload.of(
                job.getVideo().getId(), job.getPipeline(), covered, ChunkCoverage.coveredUntilMs(chunks)));
        notifier.progress(job);
    }

    private void onMergeCompleted(Job job, MergeResult result) {
        if (job.getProgress() >= MERGE_END) {
            return;
        }
        job.updateProgress(MERGE_END);
        jobMessagePublisher.publish(job.getId(), MessageType.JOB_TTS, TtsPayload.of(result.descriptionId()));
        notifier.progress(job);
    }

    private void onTtsCompleted(Job job, TtsResult result) {
        List<JobChunk> chunks = jobChunkRepository.findByJob_IdOrderByChunkIndexAsc(job.getId());
        Integer coveredUntilMs = ChunkCoverage.coveredUntilMs(chunks);
        descriptionService.publish(result.descriptionId());
        job.complete(coveredUntilMs != null);
        notifier.completed(job, result.descriptionId(), coveredUntilMs);
        countFinished(job);
    }

    private void failJob(Job job, String errorCode) {
        job.fail(errorCode == null ? UNKNOWN_ERROR : errorCode);
        // 유튜브 영상이 지워졌거나 비공개로 바뀌어 실패했으면 영상도 '볼 수 없음'으로 표시한다
        if ("VIDEO_UNAVAILABLE".equals(errorCode) && job.getVideo() != null) {
            job.getVideo().markUnavailable();
        }
        if (job.getPipeline() == Pipeline.LOCAL) {
            uploadService.failTranscode(job.getVideo().getId());
        }
        notifier.failed(job);
        countFinished(job);
    }

    private JobChunk findChunk(Job job, Integer chunkIndex) {
        if (chunkIndex == null) {
            return null;
        }
        JobChunk chunk = jobChunkRepository.findByJob_IdAndChunkIndex(job.getId(), chunkIndex).orElse(null);
        if (chunk == null) {
            log.warn("없는 조각의 이벤트 jobId={} chunk={}", job.getId(), chunkIndex);
        }
        return chunk;
    }

    private static String lastError(JobMessage envelope, String key, String defaultValue) {
        Object value = envelope.lastError() == null ? null : envelope.lastError().get(key);
        return value == null ? defaultValue : value.toString();
    }

    private static Category toCategory(String value) {
        try {
            return value == null ? Category.ETC : Category.valueOf(value);
        } catch (IllegalArgumentException e) {
            return Category.ETC;
        }
    }

    private void countFinished(Job job) {
        meterRegistry.counter("audisay.job.finished", "status", job.getStatus().name()).increment();
    }
}
