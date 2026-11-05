package com.audisay.global.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

import java.time.Duration;

@ConfigurationProperties("audisay.job")
public record JobProperties(boolean partialOnChunkFailure, @DefaultValue Stale stale) {

    /** 멈춘 작업 정리(StaleJobCleaner). 마지막 활동 뒤 이 시간이 지나도록 소식이 없으면 FAILED */
    public record Stale(
            @DefaultValue("true") boolean enabled,
            @DefaultValue("2h") Duration queuedTimeout,
            @DefaultValue("45m") Duration runningTimeout
    ) {
    }
}
