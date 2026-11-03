package com.audisay.global.external.s3;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.core.exception.SdkException;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;

/**
 * videos.thumbnail_url → 응답용 주소. 유튜브는 주소 그대로, 업로드는 S3 키라 presigned GET(6시간)으로 바꾼다.
 * 만들 수 없으면 null(FE는 썸네일 없이 보여 줌)
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ThumbnailUrlResolver {
    private final S3Presigner s3Presigner;
    private final S3Properties properties;

    public String resolve(String thumbnailUrl) {
        if (thumbnailUrl == null || thumbnailUrl.startsWith("http://") || thumbnailUrl.startsWith("https://")) {
            return thumbnailUrl;
        }
        if (!properties.hasBucket()) {
            return null;
        }
        try {
            GetObjectPresignRequest request = GetObjectPresignRequest.builder()
                    .signatureDuration(properties.thumbnailUrlExpiration())
                    .getObjectRequest(builder -> builder.bucket(properties.bucket()).key(thumbnailUrl))
                    .build();
            return s3Presigner.presignGetObject(request).url().toString();
        } catch (SdkException e) {
            log.warn("[S3] 썸네일 주소 생성 실패 key={}: {}", thumbnailUrl, e.getMessage());
            return null;
        }
    }
}
