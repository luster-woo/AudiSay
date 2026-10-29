package com.audisay.global.external.s3;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.util.unit.DataSize;

import java.time.Duration;

/**
 * @param uploadPartSize            업로드 조각 크기. 마지막 조각만 이보다 작을 수 있다(S3 최소 5MB)
 * @param uploadPartUrlExpiration   조각 업로드 주소(presigned PUT) 유효기간
 * @param playbackUrlExpiration     재생용 파일 주소(presigned GET) 유효기간
 */
@ConfigurationProperties("audisay.s3")
public record S3Properties(
        String region,
        String bucket,
        String accessKeyId,
        String secretAccessKey,
        Duration audioUrlExpiration,
        DataSize uploadPartSize,
        Duration uploadPartUrlExpiration,
        Duration playbackUrlExpiration
) {
    public boolean hasBucket() {
        return bucket != null && !bucket.isBlank();
    }

    public boolean hasAccessKey() {
        return accessKeyId != null && !accessKeyId.isBlank();
    }
}
