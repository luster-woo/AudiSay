package com.audisay.domain.chat.repository;

import com.audisay.domain.chat.entity.ChatLog;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ChatLogRepository extends JpaRepository<ChatLog, Long> {
}   
