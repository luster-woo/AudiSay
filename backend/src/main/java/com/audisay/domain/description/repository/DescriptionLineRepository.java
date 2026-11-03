package com.audisay.domain.description.repository;

import com.audisay.domain.description.entity.DescriptionLine;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;

public interface DescriptionLineRepository extends JpaRepository<DescriptionLine, Long> {

    /**
     * 상세도 1~3 전부. 시각 → 문장 순서 → 상세도 순
     */
    @Query("""
            select l from DescriptionLine l
            where l.description.id = :descriptionId
            order by l.startMs, l.lineIndex, l.detailLevel
            """)
    List<DescriptionLine> findAllByDescriptionId(Long descriptionId);

    /** [fromMs, toMs] 안에서 시작하는 문장. 시각 → 문장 순서 → 상세도 순 */
    @Query("""
            select l from DescriptionLine l
            where l.description.id = :descriptionId
              and l.startMs between :fromMs and :toMs
            order by l.startMs, l.lineIndex, l.detailLevel
            """)
    List<DescriptionLine> findInRange(Long descriptionId, Integer fromMs, Integer toMs);
}
