package com.audisay.global.external.s3;

import com.github.benmanes.caffeine.cache.Ticker;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.util.unit.DataSize;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

class AudioUrlResolverTest {
    private final S3Presigner presigner = spy(S3Presigner.builder()
            .region(Region.AP_NORTHEAST_2)
            .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create("test", "test")))
            .build());
    private final AtomicLong nanos = new AtomicLong();
    private final Ticker ticker = nanos::get;

    @Test
    void 같은_키는_한_번만_서명하고_같은_주소를_준다() {
        AudioUrlResolver resolver = resolver("audisay-test");

        String first = resolver.resolve("audio/lines/1/10.mp3");
        String second = resolver.resolve("audio/lines/1/10.mp3");

        assertThat(first).contains("audio/lines/1/10.mp3").contains("X-Amz-Expires=21600");
        assertThat(second).isEqualTo(first);
        verify(presigner, times(1)).presignGetObject(any(GetObjectPresignRequest.class));
    }

    @Test
    void 키가_다르면_따로_서명한다() {
        AudioUrlResolver resolver = resolver("audisay-test");

        assertThat(resolver.resolve("audio/lines/1/10.mp3")).isNotEqualTo(resolver.resolve("audio/lines/1/11.mp3"));
        verify(presigner, times(2)).presignGetObject(any(GetObjectPresignRequest.class));
    }

    @Test
    void 유효기간의_6분의_1이_지나면_다시_서명한다() {
        AudioUrlResolver resolver = resolver("audisay-test");

        resolver.resolve("audio/summary/1.mp3");
        nanos.addAndGet(Duration.ofMinutes(59).toNanos());
        resolver.resolve("audio/summary/1.mp3");
        verify(presigner, times(1)).presignGetObject(any(GetObjectPresignRequest.class));

        nanos.addAndGet(Duration.ofMinutes(2).toNanos());
        resolver.resolve("audio/summary/1.mp3");
        verify(presigner, times(2)).presignGetObject(any(GetObjectPresignRequest.class));
    }

    @Test
    void 키가_없거나_버킷_설정이_없으면_null() {
        assertThat(resolver("audisay-test").resolve(null)).isNull();
        assertThat(resolver("").resolve("audio/lines/1/10.mp3")).isNull();
        verify(presigner, times(0)).presignGetObject(any(GetObjectPresignRequest.class));
    }

    @Test
    void 캐시_시간은_주소_유효기간의_6분의_1() {
        assertThat(AudioUrlResolver.cacheTtl(Duration.ofHours(6))).isEqualTo(Duration.ofHours(1));
    }

    private AudioUrlResolver resolver(String bucket) {
        S3Properties properties = new S3Properties("ap-northeast-2", bucket, "test", "test", Duration.ofHours(6),
                DataSize.ofMegabytes(10), Duration.ofMinutes(30), Duration.ofHours(1), Duration.ofHours(6));
        return new AudioUrlResolver(presigner, properties, new SimpleMeterRegistry(), ticker);
    }
}
