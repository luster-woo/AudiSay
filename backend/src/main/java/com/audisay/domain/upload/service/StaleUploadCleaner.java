package com.audisay.domain.upload.service;

import com.audisay.domain.video.entity.Video;
import com.audisay.domain.video.entity.VideoUpload;
import com.audisay.domain.video.repository.VideoRepository;
import com.audisay.domain.video.repository.VideoUploadRepository;
import com.audisay.global.external.s3.S3StorageClient;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.List;

/**
 * 시작한 지 24시간이 지나도 완료·취소되지 않은 업로드를 업로드 중단과 같은 방식으로 정리한다.
 * S3에 남은 조각을 지우고(AbortMultipartUpload) 영상 행을 지운다(video_uploads는 함께 지워짐).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class StaleUploadCleaner {
    private static final int BATCH_SIZE = 100;

    private final VideoUploadRepository videoUploadRepository;
    private final VideoRepository videoRepository;
    private final S3StorageClient s3StorageClient;
    private final TransactionTemplate transactionTemplate;

    @Scheduled(fixedDelay = 3_600_000, initialDelay = 60_000)
    public void cleanUp() {
        cleanUp(Instant.now());
    }

    /**
     * 업로드마다 트랜잭션을 따로 열어, 하나가 실패해도 나머지는 정리한다. 실패한 업로드는 다음 주기에 다시 시도한다.
     *
     * @return 정리한 업로드 수
     */
    int cleanUp(Instant now) {
        Instant before = now.minus(UploadService.IN_PROGRESS_WINDOW);
        List<Long> videoIds = videoUploadRepository.findStaleVideoIds(
                UploadService.IN_PROGRESS, before, PageRequest.of(0, BATCH_SIZE));
        int cleaned = 0;
        for (Long videoId : videoIds) {
            try {
                if (Boolean.TRUE.equals(transactionTemplate.execute(status -> cleanUpOne(videoId, before)))) {
                    cleaned++;
                }
            } catch (RuntimeException e) {
                log.warn("[업로드 정리] 실패, 다음 주기에 다시 시도 videoId={}: {}", videoId, e.getMessage());
            }
        }
        if (!videoIds.isEmpty()) {
            log.info("[업로드 정리] 대상 {}개 중 {}개 정리", videoIds.size(), cleaned);
        }
        return cleaned;
    }

    /** 행을 잠근 뒤 다시 확인한다. 그 사이 완료·취소됐으면 건너뛴다 */
    private boolean cleanUpOne(Long videoId, Instant before) {
        VideoUpload upload = videoUploadRepository.findByIdForUpdate(videoId).orElse(null);
        if (upload == null || upload.isClosed() || !upload.getCreatedAt().isBefore(before)) {
            return false;
        }
        if (upload.getS3UploadId() != null) {
            s3StorageClient.abortMultipartUpload(upload.getOriginalKey(), upload.getS3UploadId());
        }
        Video video = upload.getVideo();
        videoUploadRepository.delete(upload);
        videoRepository.delete(video);
        return true;
    }
}
