package com.audisay.domain.chat.screen;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 화면 다시 보기 답 고르기(순수 규칙). 2026-11-10 스파이크(backend/build/eval/requery_spike.py, 1차 21 + 확인 19문항)에서 정했다.
 * <ul>
 *   <li>맞게 읽은 숫자는 모델끼리 같고, 지어낸 숫자(게임 화면 아래 작은 KDA·골드)는 모델마다 다르다 → 숫자가 있는 답은 두 모델 이상 같을 때만</li>
 *   <li>개수는 가려진 사람을 똑같이 빼고 세어 두 모델이 함께 틀린다(치이카와 6명을 둘 다 4명) → 세 모델의 범위로 말하고 "보이는 것만 세면"을 붙인다</li>
 *   <li>숫자가 없는 답(색·옷·사물, "확인할 수 없어요")은 싼 모델과 상위 모델 품질이 같아 하나로 끝낸다</li>
 * </ul>
 */
public final class ScreenAnswerJudge {
    /** 숫자 답이 모델마다 달라 믿을 수 없을 때 */
    public static final String UNSURE = "화면만으로는 정확한 숫자를 확인하기 어려워요.";
    /** 개수가 모델마다 크게 다를 때 */
    public static final String COUNT_UNSURE = "화면만으로는 정확히 세기 어려워요.";
    /** 개수 범위를 이 차이까지만 말한다(2~4명). 더 벌어지면 모른다고 */
    static final int MAX_COUNT_SPREAD = 2;

    public enum Kind {
        /** 색·옷·누구·무엇. 싼 모델 하나 */
        GENERAL,
        /** 몇·얼마·점수·시간·나이·가격… 두 모델을 맞춰 본다 */
        NUMERIC,
        /** 몇 명·몇 마리·몇 개. 세 모델 범위 */
        COUNT
    }

    /** @param answered false면 답이 아니다(모른다·확인할 수 없다) → UNANSWERABLE */
    public record Verdict(String text, boolean answered, String reason) {
    }

    private static final Pattern COUNT_Q = Pattern.compile(
            "몇\\s*(명|마리|개|사람|그루|송이|척|채)");
    private static final Pattern NUMERIC_Q = Pattern.compile(
            "몇|얼마|점수|스코어|시간|나이|가격|순위|등수|기온|온도|퍼센트|%|kda|골드|킬|데스|어시|cs|레벨|그램|킬로|미터",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    private static final Pattern DIGITS = Pattern.compile("\\d+(?:[.,/:\\-]\\d+)*");
    private static final Pattern SPLIT = Pattern.compile("[.,/:\\-]");
    /** 한글 수는 뒤에 세는 말이 올 때만('한·두·세·네'는 다른 뜻이 많다) */
    private static final Map<String, Integer> KO_NUM = Map.ofEntries(
            Map.entry("하나", 1), Map.entry("한", 1), Map.entry("둘", 2), Map.entry("두", 2), Map.entry("셋", 3),
            Map.entry("세", 3), Map.entry("넷", 4), Map.entry("네", 4), Map.entry("다섯", 5), Map.entry("여섯", 6),
            Map.entry("일곱", 7), Map.entry("여덟", 8), Map.entry("아홉", 9), Map.entry("열", 10), Map.entry("스물", 20));
    private static final Pattern KO_COUNT = Pattern.compile(
            "(?<![가-힣])(하나|다섯|여섯|일곱|여덟|아홉|스물|한|둘|두|셋|세|넷|네|열)\\s?(명|사람|마리|개|번|대|살|컵|잔|장|권|점|골|킬)");
    private static final Pattern MINUTE = Pattern.compile("(\\d+)\\s*분|(\\d+):\\d{2}");
    /** 모델이 화면에서 찾지 못했다고 한 답 */
    private static final Pattern REFUSAL = Pattern.compile(
            "확인할 수 없|확인하기 어렵|알 수 없|알기 어렵|나오지 않|나와 있지 않|보이지 않|표시되지 않|나타나 있지 않|세기 어렵|정보는 없|정보가 없"
                    + "|읽을 수 없|읽기 어렵|알아볼 수 없|알아보기 어렵");

    /** 겉모습·글자를 묻는 질문(색·옷·모양·적힌 글자). 사건(몇 초 걸렸어?·깨?·이겨?)은 아니다 */
    private static final Pattern APPEARANCE_Q = Pattern.compile(
            "색|옷|유니폼|입고|입었|모자|머리|신발|안경|생김|생겼|모양|무늬|로고|글자|글씨|문구|뭐라고|적혀|쓰여|써\\s?있");

    /** 화면 글자 내용을 묻는 질문("뭐라고 써 있어?", "뭐가 적혀 있어?") */
    private static final Pattern READ_Q = Pattern.compile(
            "뭐라고|무슨\\s?(글|글자|글씨|문구|말)|적혀\\s?있|쓰여\\s?있|써\\s?있");
    /** 내용 없이 "목록이 적혀 있어요"처럼 무엇이 있는지만 말한 답 */
    private static final Pattern VAGUE_TEXT = Pattern.compile(
            "(목록|내용|글자|글씨|문구|메모|할 일|문장|안내|숫자)(이|가|들이)\\s?(적혀|쓰여|써|보|있|나와|표시)");
    private static final Pattern QUOTE = Pattern.compile("['‘’\"“”「」]");

    private ScreenAnswerJudge() {
    }

    /**
     * 뒤에 답이 있어도 화면을 먼저 볼 질문인지: 지금 보이는 겉모습·글자만. 앞으로 일어날 일을 묻는 질문은 지금 화면으로 답하면
     * 틀리거나 스포일러가 된다(2026-11-10 eval_285: "농부가 창문을 깨?" → "아니요", "시속 60마일까지 몇 초?" → 타이머 1초)
     */
    public static boolean appearance(String question) {
        return question != null && APPEARANCE_Q.matcher(question).find();
    }

    /**
     * 글자 내용을 물었는데 저장 자료 답이 내용 없이 끝났는지(2026-11-10 새 영상 평가 n13: "메모지에 뭐 해야 한다고 적혀 있어?"
     * → "노란 메모지에는 마감 할 일 목록이 적혀 있습니다"). 따옴표로 내용을 옮긴 답은 읽은 것으로 본다
     */
    public static boolean textNotRead(String question, String answer) {
        if (question == null || answer == null || answer.isBlank()) {
            return false;
        }
        return READ_Q.matcher(question).find() && VAGUE_TEXT.matcher(answer).find() && !QUOTE.matcher(answer).find();
    }

    public static Kind kind(String question) {
        String q = question == null ? "" : question;
        if (COUNT_Q.matcher(q).find()) {
            return Kind.COUNT;
        }
        return NUMERIC_Q.matcher(q).find() ? Kind.NUMERIC : Kind.GENERAL;
    }

    /** 개수 질문의 세는 말("몇 명" → 명). 없으면 "개" */
    static String unit(String question) {
        Matcher m = COUNT_Q.matcher(question == null ? "" : question);
        if (!m.find()) {
            return "개";
        }
        String u = m.group(1);
        return "사람".equals(u) ? "명" : u;
    }

    /** 답 속 낱 숫자를 나온 순서대로('0/0/1' → 0,0,1, '2-1' → 2,1, '다섯 명' → 5) */
    static List<String> numbers(String text) {
        if (text == null) {
            return List.of();
        }
        Matcher ko = KO_COUNT.matcher(text);
        StringBuilder converted = new StringBuilder();
        while (ko.find()) {
            ko.appendReplacement(converted, KO_NUM.get(ko.group(1)) + ko.group(2));
        }
        ko.appendTail(converted);
        List<String> out = new ArrayList<>();
        Matcher m = DIGITS.matcher(converted);
        while (m.find()) {
            for (String part : SPLIT.split(m.group())) {
                if (!part.isEmpty()) {
                    String trimmed = part.replaceFirst("^0+", "");
                    out.add(trimmed.isEmpty() ? "0" : trimmed);
                }
            }
        }
        return out;
    }

    /**
     * 같은 값인지. 숫자 집합이 같거나, 짧은 쪽(숫자 2개 이상)이 긴 쪽 안에 같은 순서로 이어서 들어 있으면 같다
     * ('T1 0대 BLG 3' ⊇ '0 대 3', '1999년 1위 6위' ⊇ '1위 6위'). 숫자 하나는 집합이 같을 때만('2회' ≠ '2대 1')
     */
    static boolean agree(List<String> a, List<String> b) {
        if (a.isEmpty() || b.isEmpty()) {
            return false;
        }
        if (new HashSet<>(a).equals(new HashSet<>(b))) {
            return true;
        }
        List<String> shorter = a.size() <= b.size() ? a : b;
        List<String> longer = a.size() <= b.size() ? b : a;
        int n = shorter.size();
        if (n < 2) {
            return false;
        }
        for (int i = 0; i + n <= longer.size(); i++) {
            if (longer.subList(i, i + n).equals(shorter)) {
                return true;
            }
        }
        return false;
    }

    /** 게임·경기 시각은 분까지만 맞아도 같게 본다(24분 20초 vs 24분 50초) */
    static boolean sameValue(String a, String b) {
        if (a == null || b == null) {
            return false;
        }
        if (agree(numbers(a), numbers(b))) {
            return true;
        }
        String ma = minutes(a);
        return ma != null && ma.equals(minutes(b));
    }

    private static String minutes(String text) {
        Matcher m = MINUTE.matcher(text);
        if (!m.find()) {
            return null;
        }
        return m.group(1) != null ? m.group(1) : m.group(2);
    }

    static boolean refusal(String text) {
        return text != null && REFUSAL.matcher(text).find();
    }

    /** 숫자가 없는 답 하나로 끝낼 수 있는지(싼 모델 답) */
    public static boolean settledWithoutNumbers(String answer) {
        return answer != null && numbers(answer).isEmpty();
    }

    /** 한 모델 답으로 끝낼 때(숫자가 없는 답) */
    public static Verdict single(String answer) {
        return verdict(answer, "숫자 없음(한 모델)");
    }

    /**
     * 두 모델(주·싼). 숫자가 없으면 주 모델 답(주 모델이 실패했으면 싼 모델 답), 숫자가 같으면 주 모델 답.
     * 정하지 못하면 null → 셋째 모델로 {@link #vote}
     */
    public static Verdict pair(String main, String cheap) {
        if (main != null && cheap != null && numbers(main).isEmpty() && numbers(cheap).isEmpty()) {
            return verdict(main, "숫자 없음(두 모델)");
        }
        if (main == null && cheap != null && numbers(cheap).isEmpty()) {
            return verdict(cheap, "숫자 없음(주 모델 실패)");
        }
        if (sameValue(main, cheap)) {
            return verdict(main, "두 모델 일치");
        }
        return null;
    }

    /**
     * 다수결(첫째가 주 모델, null은 실패). 숫자 없는 주 모델 답은 그대로, 주 모델이 실패했고 남은 답에도 숫자가 없으면 남은 첫 답.
     * 숫자가 있으면 두 모델 이상 같은 값일 때만(주 모델이 그 편이면 주 모델 답). 모두 다르면 모른다고. 모두 실패면 null
     */
    public static Verdict vote(List<String> answers) {
        List<String> live = answers.stream().filter(Objects::nonNull).toList();
        if (live.isEmpty()) {
            return null;
        }
        String main = answers.get(0);
        if (main != null && numbers(main).isEmpty()) {
            return verdict(main, "숫자 없음");
        }
        if (live.stream().allMatch(x -> numbers(x).isEmpty())) {
            return verdict(live.get(0), "숫자 없음(주 모델 실패)");
        }
        for (int i = 0; i < answers.size(); i++) {
            String x = answers.get(i);
            if (x == null || numbers(x).isEmpty()) {
                continue;
            }
            for (int j = 0; j < answers.size(); j++) {
                if (j != i && sameValue(x, answers.get(j))) {
                    return verdict(x, i == 0 ? "다수 일치(주)" : "다수 일치");
                }
            }
        }
        return new Verdict(UNSURE, false, "모두 다름");
    }

    /**
     * 개수: 세 모델이 센 수(답의 첫 숫자). 모두 같으면 그 수, 차이가 {@link #MAX_COUNT_SPREAD} 이하면 범위, 아니면 모른다고.
     * 센 모델이 하나뿐이면 믿지 않는다. 아무도 세지 않았으면(모두 "확인할 수 없어요") 첫 답. 모두 실패면 null
     */
    public static Verdict count(List<String> answers, String question) {
        List<String> live = answers.stream().filter(Objects::nonNull).toList();
        if (live.isEmpty()) {
            return null;
        }
        List<Integer> counts = new ArrayList<>();
        for (String x : live) {
            List<String> n = numbers(x);
            if (!n.isEmpty()) {
                counts.add(Integer.parseInt(n.get(0)));
            }
        }
        if (counts.isEmpty()) {
            return verdict(live.get(0), "센 모델 없음");
        }
        if (counts.size() < 2) {
            return new Verdict(COUNT_UNSURE, false, "센 모델 하나");
        }
        int min = counts.stream().mapToInt(Integer::intValue).min().orElseThrow();
        int max = counts.stream().mapToInt(Integer::intValue).max().orElseThrow();
        String unit = unit(question);
        if (min == max) {
            return new Verdict("화면에 보이는 것만 세면 " + min + unit + copula(unit) + ".", true, "개수 일치");
        }
        if (max - min <= MAX_COUNT_SPREAD) {
            return new Verdict("화면에 보이는 것만 세면 " + min + "~" + max + unit + " 정도예요. 가려진 것이 있을 수 있어요.",
                    true, "개수 범위");
        }
        return new Verdict(COUNT_UNSURE, false, "개수 차이 큼");
    }

    /** 받침이 있으면 "이에요", 없으면 "예요"(3명이에요, 3마리예요) */
    static String copula(String unit) {
        char last = unit.charAt(unit.length() - 1);
        boolean batchim = last >= '가' && last <= '힣' && (last - '가') % 28 != 0;
        return batchim ? "이에요" : "예요";
    }

    private static Verdict verdict(String text, String reason) {
        return new Verdict(text.strip(), !refusal(text), reason);
    }
}
