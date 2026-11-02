package com.audisay.domain.job.service;

import com.audisay.domain.description.service.DescriptionService;
import com.audisay.domain.job.entity.Job;
import com.audisay.domain.job.entity.JobChunk;
import com.audisay.domain.job.entity.JobStage;
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

import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class JobEventService {
    private static final int PREPARE_END = 20;
    private static final int DESCRIBE_END = 70;
    private static final int MERGE_END = 80;
    private static final String UNKNOWN_ERROR = "UNKNOWN";
    private static final String TRANSCODE_FAILED = "TRANSCODE_FAILED";
    private static final String YOUTUBE_WATCH_URL = "https://www.youtube.com/watch?v=";

    private final JobRepository jobRepository;
    private final JobChunkRepository jobChunkRepository;
    private final JobMessagePublisher jobMessagePublisher;
    private final JobProgressNotifier notifier;
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
                afterChunkFinished(job);
            }
            case JOB_TTS -> onTtsCompleted(job, objectMapper.convertValue(envelope.payload(), TtsResult.class));
            case JOB_PREPARE, JOB_MERGE -> failJob(job, errorCode);
            case LINE_TTS, JOB_EVENT -> {
            }
        }
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
