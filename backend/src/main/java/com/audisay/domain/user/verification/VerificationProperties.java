package com.audisay.domain.user.verification;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * @param dailyAttempts 회원당 하루(KST) 인증 서류 확인 횟수(기본 5). 넘으면 USER_007
 */
@ConfigurationProperties("audisay.verification")
public record VerificationProperties(Integer dailyAttempts) {

    public VerificationProperties {
        dailyAttempts = dailyAttempts == null ? 5 : dailyAttempts;
    }
}
