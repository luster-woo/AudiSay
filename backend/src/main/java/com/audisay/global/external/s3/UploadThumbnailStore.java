package com.audisay.global.external.s3;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.core.exception.SdkException;
import software.amazon.awssdk.services.s3.S3Client;

import java.time.Duration;

/**
 * 업로드 영상 썸네일. 워커는 원본 옆(uploads/{videoId}/thumb.jpg, ai/app/pipeline/local.py thumb_key)에 올리는데
 * 업로드 원본은 수명 주기 규칙으로 지워지므로(uploads/ 기준이면 썸네일도 함께) 규칙 밖(thumbnails/uploads/)으로 복사해 쓴다.
 * 복사하지 못하면(버킷 없음·권한 없음) 원래 키를 쓴다
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class UploadThumbnailStore {
    /** 작업 행 잠금·DB 트랜잭션 안에서 부르므로 S3가 느리면 기다리지 않고 원래 키를 쓴다(재시도 포함 전체 시간) */
    private static final Duration COPY_TIMEOUT = Duration.ofSeconds(3);

    private final S3Client s3Client;
    private final S3Properties properties;

    /** @return videos.thumbnail_url에 넣을 S3 키 */
    public String keep(Long videoId) {
        String source = workerKey(videoId);
        if (!properties.hasBucket()) {
            return source;
        }
        String target = keptKey(videoId);
        try {
            s3Client.copyObject(builder -> builder
                    .sourceBucket(properties.bucket()).sourceKey(source)
                    .destinationBucket(properties.bucket()).destinationKey(target)
                    .overrideConfiguration(o -> o.apiCallTimeout(COPY_TIMEOUT)));
            return target;
        } catch (SdkException e) {
            log.warn("[S3] 업로드 썸네일 복사 실패, 원래 키를 씀 videoId={}: {}", videoId, e.getMessage());
            return source;
        }
    }

    static String workerKey(Long videoId) {
        return "uploads/%d/thumb.jpg".formatted(videoId);
    }

    static String keptKey(Long videoId) {
        return "thumbnails/uploads/%d.jpg".formatted(videoId);
    }
}
