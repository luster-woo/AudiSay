package com.audisay.global.config;

import com.audisay.domain.user.entity.Role;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.util.unit.DataSize;

import java.util.Optional;

/**
 * 역할별 이용 제한 (application.yml의 audisay.usage-limits). 관리자는 제한이 없다.
 */
@ConfigurationProperties("audisay.usage-limits")
public record UsageLimitProperties(RoleLimit general, RoleLimit visuallyImpaired) {

    /** 관리자면 비어 있다 */
    public Optional<RoleLimit> forRole(Role role) {
        return switch (role) {
            case GENERAL -> Optional.of(general);
            case VISUALLY_IMPAIRED -> Optional.of(visuallyImpaired);
            case ADMIN -> Optional.empty();
        };
    }

    public record RoleLimit(YoutubeLimit youtube, UploadLimit upload) {
    }

    public record YoutubeLimit(int maxDurationSec, int dailyCount) {
    }

    public record UploadLimit(int maxDurationSec, int dailyCount, DataSize maxSize) {
    }
}
