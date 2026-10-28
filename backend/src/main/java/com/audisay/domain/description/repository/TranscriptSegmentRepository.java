package com.audisay.domain.description.repository;

import com.audisay.domain.description.entity.TranscriptSegment;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;

public interface TranscriptSegmentRepository extends JpaRepository<TranscriptSegment, Long> {

    /**
     * 인물 이름을 같이 꺼내려고 character를 fetch join한다(N+1 방지)
     */
    @Query("""
            select t from TranscriptSegment t
            left join fetch t.character
            where t.description.id = :descriptionId
            order by t.startMs
            """)
    List<TranscriptSegment> findAllWithCharacterByDescriptionId(Long descriptionId);
}