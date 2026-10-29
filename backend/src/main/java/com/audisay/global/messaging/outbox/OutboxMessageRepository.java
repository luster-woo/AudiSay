package com.audisay.global.messaging.outbox;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;

public interface OutboxMessageRepository extends JpaRepository<OutboxMessage, Long> {

    // 서버가 여러 대여도 같은 행을 동시에 재발행하지 않도록 잠그고, 잠긴 행은 건너뛴다
    @Query(value = """
            SELECT * FROM outbox_messages
            WHERE status = 'PENDING' AND created_at < :before
            ORDER BY id
            LIMIT :limit
            FOR UPDATE SKIP LOCKED
            """, nativeQuery = true)
    List<OutboxMessage> findPendingForRelay(@Param("before") Instant before, @Param("limit") int limit);
}
