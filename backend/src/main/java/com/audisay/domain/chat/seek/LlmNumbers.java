package com.audisay.domain.chat.seek;

import lombok.extern.slf4j.Slf4j;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** LLM이 돌려준 번호 목록 {"n": [2, 5]}·{"ok": [1]}을 읽는다. 범위 밖·중복은 빼고, ```json 감싸기·문자열 번호("2")도 받는다 */
@Slf4j
final class LlmNumbers {

    private LlmNumbers() {
    }

    /** @return 번호 목록, 읽을 수 없으면 null(호출한 쪽이 실패로 처리) */
    static List<Integer> parse(ObjectMapper objectMapper, String text, String key, int max) {
        int start = text == null ? -1 : text.indexOf('{');
        int end = text == null ? -1 : text.lastIndexOf('}');
        if (start < 0 || end <= start) {
            log.warn("LLM 응답이 JSON이 아닙니다: {}", abbreviate(text));
            return null;
        }
        Map<?, ?> json;
        try {
            json = objectMapper.readValue(text.substring(start, end + 1), Map.class);
        } catch (JacksonException e) {
            log.warn("LLM 응답을 읽지 못했습니다: {}", abbreviate(text));
            return null;
        }
        if (!(json.get(key) instanceof List<?> values)) {
            log.warn("LLM 응답에 {} 목록이 없습니다: {}", key, abbreviate(text));
            return null;
        }
        Set<Integer> numbers = new LinkedHashSet<>();
        for (Object value : values) {
            Integer n = number(value);
            if (n != null && n >= 1 && n <= max) {
                numbers.add(n);
            }
        }
        return new ArrayList<>(numbers);
    }

    /** 정수만 번호로 본다(1.9 → 1, 4294967297 → 1처럼 잘려 범위 검사를 지나가지 않게). 범위 밖은 null */
    private static Integer number(Object value) {
        if (value instanceof Integer || value instanceof Long || value instanceof Short || value instanceof Byte
                || value instanceof java.math.BigInteger) {
            return toInt(((Number) value).longValue(), value instanceof java.math.BigInteger big
                    && big.bitLength() >= Long.SIZE);
        }
        if (value instanceof String s) {
            try {
                return toInt(Long.parseLong(s.strip()), false);
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return null;
    }

    private static Integer toInt(long n, boolean overflow) {
        return overflow || n < Integer.MIN_VALUE || n > Integer.MAX_VALUE ? null : (int) n;
    }

    private static String abbreviate(String text) {
        return text == null ? null : text.length() > 200 ? text.substring(0, 200) + "…" : text;
    }
}
