package com.audisay.global.external.s3;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

@ConfigurationProperties("audisay.s3")
public record S3Properties(
        String region,
        String bucket,
        String accessKeyId,
        String secretAccessKey,
        Duration audioUrlExpiration
) {
    public boolean hasBucket() {
        return bucket != null && !bucket.isBlank();
    }

    public boolean hasAccessKey() {
        return accessKeyId != null && !accessKeyId.isBlank();
    }
}
