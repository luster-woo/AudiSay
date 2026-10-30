package com.audisay.domain.video.service;

import com.audisay.domain.video.entity.SourceType;
import com.audisay.domain.video.repository.GenerationRequestRepository;
import com.audisay.domain.video.repository.SourceTypeCount;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.EnumMap;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class GenerationRequestService {
    /** 하루 이용 횟수는 한국 시간 기준 날짜로 센다 */
    public static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final GenerationRequestRepository generationRequestRepository;

    public static LocalDate todayKst() {
        return LocalDate.now(KST);
    }

    /**
     * 그날 횟수를 차감한 요청 수. 요청이 없는 출처는 0이다.
     */
    @Transactional(readOnly = true)
    public Map<SourceType, Long> countUsage(Long userId, LocalDate date) {
        Map<SourceType, Long> usage = new EnumMap<>(SourceType.class);
        for (SourceType sourceType : SourceType.values()) {
            usage.put(sourceType, 0L);
        }
        for (SourceTypeCount row : generationRequestRepository.countCountedBySourceType(userId, date)) {
            usage.put(row.sourceType(), row.count());
        }
        return usage;
    }

    @Transactional(readOnly = true)
    public boolean hasRequested(Long userId, Long jobId) {
        return generationRequestRepository.existsByUser_IdAndJobId(userId, jobId);
    }
}
