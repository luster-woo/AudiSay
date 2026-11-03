package com.audisay.domain.chat.intent;

import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 말 속의 시각("1분 30초", "일 분 삼십 초", "이분 십초", "한 시간 반", "3:20")을 ms로 바꾼다.
 * 붙어 있는 시간·분·초 묶음 하나만 읽고, 묶음이 끝난 위치를 함께 돌려준다(뒤에 "로"·"전으로"가 오는지 보려고)
 */
final class KoreanTime {
    private static final String NATIVE_ONES = "한|하나|두|둘|세|셋|네|넷|다섯|여섯|일곱|여덟|아홉";
    private static final String NUM = "\\d+|[일이삼사오육칠팔구십백]+|(?:열|스물|스무|서른|마흔|쉰)(?:" + NATIVE_ONES + ")?|" + NATIVE_ONES;
    private static final Pattern PART = Pattern.compile(
            "(?:(?<![가-힣])|(?<=[분간초]))(" + NUM + ")\\s*(시간|분(?![석위들])|초(?!반))(\\s*반)?");
    private static final Pattern CLOCK = Pattern.compile("(?<!\\d)(?:(\\d{1,2}):)?(\\d{1,2}):(\\d{2})(?!\\d)");

    private static final Map<String, Integer> SINO = Map.of("일", 1, "이", 2, "삼", 3, "사", 4, "오", 5,
            "육", 6, "칠", 7, "팔", 8, "구", 9);
    private static final Map<String, Integer> NATIVE = Map.ofEntries(Map.entry("한", 1), Map.entry("하나", 1),
            Map.entry("두", 2), Map.entry("둘", 2), Map.entry("세", 3), Map.entry("셋", 3), Map.entry("네", 4),
            Map.entry("넷", 4), Map.entry("다섯", 5), Map.entry("여섯", 6), Map.entry("일곱", 7), Map.entry("여덟", 8),
            Map.entry("아홉", 9));
    private static final Map<String, Integer> NATIVE_TENS = Map.of("열", 10, "스물", 20, "스무", 20, "서른", 30,
            "마흔", 40, "쉰", 50);

    record Match(int ms, int start, int end) {
    }

    private KoreanTime() {
    }

    static Match find(String text) {
        Matcher clock = CLOCK.matcher(text);
        if (clock.find()) {
            int h = clock.group(1) == null ? 0 : Integer.parseInt(clock.group(1));
            int ms = ((h * 60 + Integer.parseInt(clock.group(2))) * 60 + Integer.parseInt(clock.group(3))) * 1000;
            return new Match(ms, clock.start(), clock.end());
        }
        Matcher m = PART.matcher(text);
        int start = -1;
        int end = -1;
        long ms = 0;
        String lastUnit = null;
        while (m.find()) {
            if (start >= 0 && !text.substring(end, m.start()).isBlank()) {
                break;
            }
            Integer n = number(m.group(1));
            String unit = m.group(2);
            if (n == null || (lastUnit != null && order(unit) <= order(lastUnit))) {
                break;
            }
            long unitMs = switch (unit) {
                case "시간" -> 3_600_000L;
                case "분" -> 60_000L;
                default -> 1_000L;
            };
            ms += n * unitMs + (m.group(3) != null ? unitMs / 2 : 0);
            if (start < 0) {
                start = m.start();
            }
            end = m.end();
            lastUnit = unit;
        }
        return start < 0 || ms > Integer.MAX_VALUE ? null : new Match((int) ms, start, end);
    }

    private static int order(String unit) {
        return switch (unit) {
            case "시간" -> 0;
            case "분" -> 1;
            default -> 2;
        };
    }

    static Integer number(String word) {
        if (word.chars().allMatch(Character::isDigit)) {
            return word.length() > 6 ? null : Integer.parseInt(word);
        }
        Integer value = nativeNumber(word);
        return value != null ? value : sinoNumber(word);
    }

    private static Integer nativeNumber(String word) {
        for (Map.Entry<String, Integer> tens : NATIVE_TENS.entrySet()) {
            if (word.startsWith(tens.getKey())) {
                String rest = word.substring(tens.getKey().length());
                if (rest.isEmpty()) {
                    return tens.getValue();
                }
                Integer ones = NATIVE.get(rest);
                return ones == null ? null : tens.getValue() + ones;
            }
        }
        return NATIVE.get(word);
    }

    /** 일·이·삼…·십·백 ("삼십" 30, "십오" 15, "백이십" 120) */
    private static Integer sinoNumber(String word) {
        int total = 0;
        int digit = 0;
        for (char c : word.toCharArray()) {
            String s = String.valueOf(c);
            if (SINO.containsKey(s)) {
                if (digit != 0) {
                    return null;
                }
                digit = SINO.get(s);
            } else if (c == '십' || c == '백') {
                total += (digit == 0 ? 1 : digit) * (c == '십' ? 10 : 100);
                digit = 0;
            } else {
                return null;
            }
        }
        return total + digit;
    }
}
