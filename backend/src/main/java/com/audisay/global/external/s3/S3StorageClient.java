package com.audisay.global.external.s3;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.CompletedPart;
import software.amazon.awssdk.services.s3.model.NoSuchUploadException;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;
import software.amazon.awssdk.services.s3.presigner.model.PresignedGetObjectRequest;
import software.amazon.awssdk.services.s3.presigner.model.PresignedUploadPartRequest;
import software.amazon.awssdk.services.s3.presigner.model.UploadPartPresignRequest;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

/**
 * 영상 파일용 S3 호출. 브라우저가 S3에 직접 올리는 멀티파트 업로드(시작·조각 주소·완료·중단)와 재생 주소를 만든다.
 * S3 오류(S3Exception)는 그대로 던지고, 업무 오류로 바꾸는 일은 호출한 쪽이 한다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class S3StorageClient {
    private final S3Client s3Client;
    private final S3Presigner s3Presigner;
    private final S3Properties properties;

    /** @return S3 UploadId */
    public String createMultipartUpload(String key, String contentType) {
        return s3Client.createMultipartUpload(builder -> builder.bucket(bucket()).key(key).contentType(contentType))
                .uploadId();
    }

    public PresignedUrl presignUploadPart(String key, String uploadId, int partNumber) {
        UploadPartPresignRequest request = UploadPartPresignRequest.builder()
                .signatureDuration(properties.uploadPartUrlExpiration())
                .uploadPartRequest(builder -> builder.bucket(bucket()).key(key).uploadId(uploadId).partNumber(partNumber))
                .build();
        PresignedUploadPartRequest presigned = s3Presigner.presignUploadPart(request);
        return new PresignedUrl(presigned.url().toString(), presigned.expiration());
    }

    public void completeMultipartUpload(String key, String uploadId, List<UploadedPart> parts) {
        List<CompletedPart> completedParts = parts.stream()
                .map(part -> CompletedPart.builder().partNumber(part.partNumber()).eTag(part.eTag()).build())
                .toList();
        s3Client.completeMultipartUpload(builder -> builder.bucket(bucket()).key(key).uploadId(uploadId)
                .multipartUpload(upload -> upload.parts(completedParts)));
    }

    /** 이미 중단·완료되어 S3에 없는 업로드면 무시한다 */
    public void abortMultipartUpload(String key, String uploadId) {
        try {
            s3Client.abortMultipartUpload(builder -> builder.bucket(bucket()).key(key).uploadId(uploadId));
        } catch (NoSuchUploadException e) {
            log.info("[S3] 이미 없는 멀티파트 업로드 key={}", key);
        }
    }

    public PresignedUrl presignGet(String key, Duration expiration) {
        GetObjectPresignRequest request = GetObjectPresignRequest.builder()
                .signatureDuration(expiration)
                .getObjectRequest(builder -> builder.bucket(bucket()).key(key))
                .build();
        PresignedGetObjectRequest presigned = s3Presigner.presignGetObject(request);
        return new PresignedUrl(presigned.url().toString(), presigned.expiration());
    }

    private String bucket() {
        if (!properties.hasBucket()) {
            throw new IllegalStateException("S3 버킷(AWS_S3_BUCKET)이 설정되지 않았습니다.");
        }
        return properties.bucket();
    }

    public record PresignedUrl(String url, Instant expiresAt) {
    }

    public record UploadedPart(int partNumber, String eTag) {
    }
}
