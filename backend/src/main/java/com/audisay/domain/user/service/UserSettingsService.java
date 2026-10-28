package com.audisay.domain.user.service;

import com.audisay.domain.user.dto.request.SettingsUpdateRequest;
import com.audisay.domain.user.dto.response.SettingsResponse;
import com.audisay.domain.user.entity.UserSettings;
import com.audisay.domain.user.repository.UserSettingsRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;

@Service
@RequiredArgsConstructor
public class UserSettingsService {
    private final UserService userService;
    private final UserSettingsRepository userSettingsRepository;

    @Transactional(readOnly = true)
    public SettingsResponse getSettings(Long userId) {
        return SettingsResponse.from(findSettings(userId));
    }

    @Transactional
    public SettingsResponse updateSettings(Long userId, SettingsUpdateRequest request) {
        UserSettings settings = findSettings(userId);
        settings.update(request.toPatch(), Instant.now());
        return SettingsResponse.from(settings);
    }

    private UserSettings findSettings(Long userId) {
        userService.getActiveUser(userId);
        // 가입할 때 함께 만들므로 항상 있다
        return userSettingsRepository.findById(userId)
                .orElseThrow(() -> new IllegalStateException("재생 설정이 없는 회원입니다. userId=" + userId));
    }
}
