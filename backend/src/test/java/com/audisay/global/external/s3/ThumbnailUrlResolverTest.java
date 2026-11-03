package com.audisay.global.external.s3;

import org.junit.jupiter.api.Test;
import org.springframework.util.unit.DataSize;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

class ThumbnailUrlResolverTest {
    private final S3Presigner presigner = S3Presigner.builder()
            .region(Region.AP_NORTHEAST_2)
            .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create("test", "test")))
            .build();

    @Test
    void 유튜브_주소는_그대로_업로드_키는_presigned_주소로() {
        ThumbnailUrlResolver resolver = new ThumbnailUrlResolver(presigner, properties("audisay-test"));

        assertThat(resolver.resolve("https://i.ytimg.com/vi/abc/hqdefault.jpg"))
                .isEqualTo("https://i.ytimg.com/vi/abc/hqdefault.jpg");
        assertThat(resolver.resolve("uploads/9104/thumb.jpg"))
                .contains("audisay-test")
                .contains("uploads/9104/thumb.jpg")
                .contains("X-Amz-Expires=21600");
        assertThat(resolver.resolve(null)).isNull();
    }

    @Test
    void 버킷_설정이_없으면_업로드_썸네일은_null() {
        ThumbnailUrlResolver resolver = new ThumbnailUrlResolver(presigner, properties(""));

        assertThat(resolver.resolve("uploads/9104/thumb.jpg")).isNull();
        assertThat(resolver.resolve("https://i.ytimg.com/vi/abc/hqdefault.jpg")).isNotNull();
    }

    private static S3Properties properties(String bucket) {
        return new S3Properties("ap-northeast-2", bucket, "test", "test", Duration.ofHours(6), DataSize.ofMegabytes(10),
                Duration.ofMinutes(30), Duration.ofHours(1), Duration.ofHours(6));
    }
}
