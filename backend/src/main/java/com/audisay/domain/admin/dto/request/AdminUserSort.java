package com.audisay.domain.admin.dto.request;

import org.springframework.data.domain.Sort;

/**
 * 관리자 회원 목록 정렬. 예전에는 서버에 정렬이 없어 FE가 같은 조건의 회원을 50명씩 모든 쪽에 걸쳐 받아 정렬했다
 * (회원 수에 비례해 요청이 늘었다, 2026-11-10 점검)
 */
public enum AdminUserSort {
    /** 가입 최신순 (기본) */
    NEWEST(Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id"))),
    /** 가입 오래된 순 */
    OLDEST(Sort.by(Sort.Order.asc("createdAt"), Sort.Order.asc("id"))),
    /** 이름 가나다순 (같으면 가입이 빠른 회원 먼저) */
    NAME(Sort.by(Sort.Order.asc("name"), Sort.Order.asc("createdAt"), Sort.Order.asc("id")));

    private final Sort sort;

    AdminUserSort(Sort sort) {
        this.sort = sort;
    }

    public Sort sort() {
        return sort;
    }
}
