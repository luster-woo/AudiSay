package com.audisay.global.external.s3;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.github.benmanes.caffeine.cache.Ticker;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.binder.cache.CaffeineCacheMetrics;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.core.exception.SdkException;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;

import java.time.Duration;

/**
 * 음성 파일 S3 키 → presigned GET 주소. 만들 수 없으면 null(FE가 브라우저 음성으로 읽음).
 * 서명은 문장마다 CPU를 써서 해설 조회의 절반, 동시 요청에선 대부분을 차지했다 → 키별로 유효기간의 1/6(6시간이면 1시간)만 서버 메모리에 둔다.
 * 꺼내 줄 때 주소는 적어도 유효기간의 5/6이 남는다. 음성은 같은 키에 덮어쓰고, 지운 음성은 키가 비어 서명하지 않으므로 캐시를 비울 일이 없다.
 */
@Slf4j
@Component
public class AudioUrlResolver {
    static final long MAX_CACHED_URLS = 50_000;

    private final S3Presigner s3Presigner;
    private final S3Properties properties;
    private final Cache<String, String> urls;

    @Autowired
    public AudioUrlResolver(S3Presigner s3Presigner, S3Properties properties, MeterRegistry meterRegistry) {
        this(s3Presigner, properties, meterRegistry, Ticker.systemTicker());
    }

    AudioUrlResolver(S3Presigner s3Presigner, S3Properties properties, MeterRegistry meterRegistry, Ticker ticker) {
        this.s3Presigner = s3Presigner;
        this.properties = properties;
        this.urls = Caffeine.newBuilder()
                .maximumSize(MAX_CACHED_URLS)
                .expireAfterWrite(cacheTtl(properties.audioUrlExpiration()))
                .ticker(ticker)
                .recordStats()
                .build();
        CaffeineCacheMetrics.monitor(meterRegistry, urls, "audioUrl");
    }

    public String resolve(String audioKey) {
        if (audioKey == null || !properties.hasBucket()) {
            return null;
        }
        return urls.get(audioKey, this::presign);
    }

    /** 실패하면 null(캐시에 남지 않아 다음 요청에서 다시 시도) */
    private String presign(String audioKey) {
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

    static Duration cacheTtl(Duration urlExpiration) {
        return urlExpiration.dividedBy(6);
    }
}
