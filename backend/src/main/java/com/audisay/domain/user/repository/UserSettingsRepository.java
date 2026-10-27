package com.audisay.domain.user.repository;

import com.audisay.domain.user.entity.UserSettings;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserSettingsRepository extends JpaRepository<UserSettings, Long> {
}
