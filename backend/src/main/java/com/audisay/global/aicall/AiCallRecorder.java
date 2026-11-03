package com.audisay.global.aicall;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * 호출한 쪽 트랜잭션과 따로 저장한다(호출한 쪽이 롤백돼도 AI 비용 기록은 남게).
 */
@Component
@RequiredArgsConstructor
public class AiCallRecorder {
    private final AiCallLogRepository repository;

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Long record(AiCallLog callLog) {
        return repository.save(callLog).getId();
    }
}
