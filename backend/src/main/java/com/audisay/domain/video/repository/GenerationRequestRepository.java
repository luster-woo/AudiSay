package com.audisay.domain.video.repository;

import com.audisay.domain.video.entity.GenerationRequest;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;

public interface GenerationRequestRepository extends JpaRepository<GenerationRequest, Long> {

    /**
     * 그날 횟수를 차감한(counted) 요청 수를 유튜브·업로드별로 센다. (user_id, request_date) 인덱스를 쓴다.
     */
    @Query("""
            select new com.audisay.domain.video.repository.SourceTypeCount(v.sourceType, count(g))
            from GenerationRequest g join g.video v
            where g.user.id = :userId and g.requestDate = :date and g.counted = true
            group by v.sourceType
            """)
    List<SourceTypeCount> countCountedBySourceType(@Param("userId") Long userId, @Param("date") LocalDate date);
}
