package com.audisay.domain.video.repository;

import com.audisay.domain.video.entity.GenerationRequest;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
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

    /**
     * 내가 요청한 영상을 영상별로 묶어 마지막 요청 시각 최신순으로 준다. 거절(REJECTED)된 요청은 뺀다.
     */
    @Query(value = """
            select new com.audisay.domain.video.repository.MyVideoRow(g.video.id, max(g.requestedAt))
            from GenerationRequest g
            where g.user.id = :userId
              and g.result <> com.audisay.domain.video.entity.GenerationResult.REJECTED
            group by g.video.id
            order by max(g.requestedAt) desc, g.video.id desc
            """,
            countQuery = """
            select count(distinct g.video.id)
            from GenerationRequest g
            where g.user.id = :userId
              and g.result <> com.audisay.domain.video.entity.GenerationResult.REJECTED
            """)
    Page<MyVideoRow> findMyVideos(@Param("userId") Long userId, Pageable pageable);

    boolean existsByUser_IdAndJobId(Long userId, Long jobId);

    /** 그날 이 영상의 작업을 다시 만든 횟수(차감 없는 NEW_JOB). 회원과 관계없이 센다 */
    @Query("""
            select count(g) from GenerationRequest g
            where g.video.id = :videoId and g.requestDate = :date and g.counted = false
              and g.result = com.audisay.domain.video.entity.GenerationResult.NEW_JOB
            """)
    long countRetries(@Param("videoId") Long videoId, @Param("date") LocalDate date);
}
