package com.audisay.global.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("audisay.job")
public record JobProperties(boolean partialOnChunkFailure) {
}
