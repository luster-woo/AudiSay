package com.audisay.global.external.s3;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.core.exception.SdkException;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;

/**
 * 음성 파일 S3 키 → presigned GET 주소. 만들 수 없으면 null(FE가 브라우저 음성으로 읽음)
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AudioUrlResolver {
    private final S3Presigner s3Presigner;
    private final S3Properties properties;

    public String resolve(String audioKey) {
        if (audioKey == null || !properties.hasBucket()) {
            return null;
        }
        try {
            GetObjectPresignRequest request = GetObjectPresignRequest.builder()
                    .signatureDuration(properties.audioUrlExpiration())
                    .getObjectRequest(builder -> builder.bucket(properties.bucket()).key(audioKey))
                    .build();
            return s3Presigner.presignGetObject(request).url().toString();
        } catch (SdkException e) {
            log.warn("[S3] 음성 주소 생성 실패 key={}: {}", audioKey, e.getMessage());
            return null;
        }
    }
}
