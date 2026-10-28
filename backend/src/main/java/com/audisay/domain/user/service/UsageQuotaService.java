package com.audisay.domain.user.service;

import com.audisay.domain.user.dto.response.QuotaResponse;
import com.audisay.domain.user.dto.response.QuotaResponse.UploadQuota;
import com.audisay.domain.user.dto.response.QuotaResponse.YoutubeQuota;
import com.audisay.domain.user.entity.User;
import com.audisay.domain.video.entity.SourceType;
import com.audisay.domain.video.service.GenerationRequestService;
import com.audisay.global.config.UsageLimitProperties;
import com.audisay.global.config.UsageLimitProperties.RoleLimit;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.Map;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class UsageQuotaService {
    private final UserService userService;
    private final GenerationRequestService generationRequestService;
    private final UsageLimitProperties usageLimitProperties;

    /**
     * 역할별 제한(application.yml)과 오늘(KST) 사용한 횟수. 역할은 토큰이 아니라 DB의 최신 값을 쓴다.
     */
    @Transactional(readOnly = true)
    public QuotaResponse getQuota(Long userId) {
        User user = userService.getActiveUser(userId);
        LocalDate today = GenerationRequestService.todayKst();
        Map<SourceType, Long> usage = generationRequestService.countUsage(userId, today);
        long youtubeUsed = usage.get(SourceType.YOUTUBE);
        long uploadUsed = usage.get(SourceType.UPLOAD);

        Optional<RoleLimit> limit = usageLimitProperties.forRole(user.getRole());
        if (limit.isEmpty()) {
            return new QuotaResponse(user.getRole(), today,
                    new YoutubeQuota(null, null, youtubeUsed, null),
                    new UploadQuota(null, null, null, uploadUsed, null));
        }

        UsageLimitProperties.YoutubeLimit youtube = limit.get().youtube();
        UsageLimitProperties.UploadLimit upload = limit.get().upload();
        return new QuotaResponse(user.getRole(), today,
                new YoutubeQuota(youtube.maxDurationSec(), youtube.dailyCount(), youtubeUsed,
                        remaining(youtube.dailyCount(), youtubeUsed)),
                new UploadQuota(upload.maxDurationSec(), upload.maxSize().toBytes(), upload.dailyCount(), uploadUsed,
                        remaining(upload.dailyCount(), uploadUsed)));
    }

    private static int remaining(int limit, long used) {
        return (int) Math.max(0, limit - used);
    }
}
