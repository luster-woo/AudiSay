package com.audisay.global.messaging.outbox;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

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

    /**
     * 발행 확인 반영용. 재발행(findPendingForRelay)이 같은 행을 잡고 있으면 끝날 때까지 기다렸다가 그 결과(SENT)를 읽어,
     * 늦게 온 확인이 이미 SENT가 된 행을 PENDING으로 되돌리지 않게 한다
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT m FROM OutboxMessage m WHERE m.id = :id")
    Optional<OutboxMessage> findByIdForUpdate(@Param("id") Long id);
}
