package com.audisay.domain.report.repository;

import com.audisay.domain.report.entity.Report;
import com.audisay.domain.report.entity.ReportReason;
import com.audisay.domain.report.entity.ReportStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface ReportRepository extends JpaRepository<Report, Long> {

    boolean existsByUserIdAndLine_Id(Long userId, Long lineId);

    /**
     * 관리자 신고 목록. 오래된 순이다((status, created_at) 인덱스). reason·videoId가 null이면 거르지 않는다.
     */
    @Query(value = """
            select new com.audisay.domain.report.repository.AdminReportRow(
                r.id, r.status, r.reason, r.reasonDetail, v.id, v.title, d.id, l.id, l.detailLevel, l.startMs,
                r.reportedAtMs, r.lineTextSnapshot, l.text,
                (select count(r2) from Report r2 where r2.line = l),
                r.userId, r.createdAt, r.handledAt)
            from Report r join r.line l join l.description d join d.video v
            where r.status = :status
              and (:reason is null or r.reason = :reason)
              and (:videoId is null or v.id = :videoId)
            order by r.createdAt, r.id
            """,
            countQuery = """
            select count(r) from Report r join r.line l join l.description d
            where r.status = :status
              and (:reason is null or r.reason = :reason)
              and (:videoId is null or d.video.id = :videoId)
            """)
    Page<AdminReportRow> findForAdmin(@Param("status") ReportStatus status,
                                      @Param("reason") ReportReason reason,
                                      @Param("videoId") Long videoId,
                                      Pageable pageable);

    @Query("""
            select r from Report r
            where r.line.id = :lineId
              and r.status = com.audisay.domain.report.entity.ReportStatus.PENDING
            """)
    List<Report> findPendingByLineId(@Param("lineId") Long lineId);
}
