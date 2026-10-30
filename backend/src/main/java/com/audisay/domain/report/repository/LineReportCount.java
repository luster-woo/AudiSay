package com.audisay.domain.report.repository;

/**
 * 문장 하나에 들어온 신고 수.
 *
 * @param total   처리 상태와 관계없이 전체
 * @param pending 처리 전(PENDING)
 */
public record LineReportCount(Long lineId, Long total, Long pending) {
}
