package com.audisay.domain.description.repository;

import com.audisay.domain.description.entity.Description;
import com.audisay.domain.description.entity.DescriptionStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface DescriptionRepository extends JpaRepository<Description, Long> {

    List<Description> findByVideo_IdInAndStatus(Collection<Long> videoIds, DescriptionStatus status);

    Optional<Description> findByVideo_IdAndStatus(Long videoId, DescriptionStatus status);

    Optional<Description> findByJob_Id(Long jobId);

    /**
     * 0번 조각부터 연속으로 성공한 마지막 조각의 끝 시각(PARTIAL 작업용)
     */
    @Query(value = """
            select c.end_ms from job_chunks c
            where c.job_id = :jobId
              and c.status = 'SUCCEEDED'
              and not exists (
                  select 1 from job_chunks p
                  where p.job_id = c.job_id
                    and p.chunk_index < c.chunk_index
                    and p.status <> 'SUCCEEDED')
            order by c.chunk_index desc
            limit 1
            """, nativeQuery = true)
    Optional<Integer> findCoveredUntilMs(Long jobId);
}
