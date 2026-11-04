package com.audisay.domain.chat.repository;

import com.audisay.domain.chat.entity.ChatLog;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ChatLogRepository extends JpaRepository<ChatLog, Long> {

    List<ChatLog> findByUserIdAndVideoIdAndIdLessThanOrderByIdDesc(Long userId, Long videoId, Long cursor, Limit limit);
}
