package com.audisay.global.util;

import java.util.Locale;

/**
 * 대소문자를 가리지 않는 부분 일치 LIKE 패턴. 쿼리에서는 {@code lower(칼럼) like :pattern escape '!'}로 쓴다.
 */
public final class LikePattern {
    private LikePattern() {
    }

    // %, _를 글자 그대로 찾도록 이스케이프한다(이스케이프 문자는 '!'). 비어 있으면 null을 돌려줘 거르지 않게 한다
    public static String contains(String keyword) {
        if (keyword == null || keyword.isBlank()) {
            return null;
        }
        String escaped = keyword.strip().toLowerCase(Locale.ROOT)
                .replace("!", "!!")
                .replace("%", "!%")
                .replace("_", "!_");
        return "%" + escaped + "%";
    }
}
