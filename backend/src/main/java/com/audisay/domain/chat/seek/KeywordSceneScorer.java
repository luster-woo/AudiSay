package com.audisay.domain.chat.seek;

import com.audisay.domain.chat.tuning.ChatTuningProperties;
import com.audisay.domain.description.service.SceneText;
import com.audisay.domain.description.service.SceneText.Moment;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 장면 찾기 키워드 검색(LLM 없이 0크레딧). 검색어를 낱말로 나눠 조사·어미를 떼고 두 단계로 찾는다.
 * <ol>
 *     <li>목차 칸(키워드·제목 > 요약 > 장면 설명): 맞으면 그 목차 시작으로</li>
 *     <li>시각이 있는 글(해설 문장·대사·화면 글자): 맞으면 그 문장 2초 전으로 — "안타 친 장면"처럼 목차에 없고 대사에만 있는 순간</li>
 * </ol>
 * 여러 장면에 흔한 낱말일수록 점수를 낮춘다(IDF). 낱말이 절반 넘게 맞은 곳만 후보로 쓰고, 15초 안에 붙은 후보는 한 번으로 친다.
 * 오탐 줄이기: 낱말 바로 뒤가 부정("안타가 하나도 없네요", "안타를 못 쳤어요")인 문장은 빼고, 요약·기록하는 말("오늘", "지금까지")은 점수를 반으로,
 * 15초 안에 대사·해설 문장·화면 글자가 함께 말하는 후보는 점수를 올린다(evidence = 겹친 자료 종류 수)
 * <ul>
 *     <li>MULTIPLE: 낱말이 모두 맞은 곳이 둘 이상("안타 친 장면")이거나 점수가 비슷한 곳이 여럿 — 전부, 지금 시각 이후부터 시간순</li>
 *     <li>SINGLE: 1등이 2등의 1.5배 이상 — 그곳으로 바로</li>
 *     <li>NONE: 후보가 없음 — LLM이 고른다</li>
 * </ul>
 */
@Component
public class KeywordSceneScorer {
    static final double MARGIN = 1.5;
    static final int LEAD_MS = 2_000;
    static final int MERGE_WINDOW_MS = 15_000;
    static final double SUMMARY_PENALTY = 0.5;
    static final double EVIDENCE_BONUS = 0.3;
    /**
     * 낱말 뒤 같은 마디(문장부호 전, 12자 안)에 오면 그 일이 일어나지 않은 것. 가정·막힘도 포함
     * ("득점이 될 만한", "골이 될 수도", "골을 막아 냅니다")
     */
    private static final Pattern NEGATION = Pattern.compile(
            "없|못|아니|안 |실패|무산|놓치|놓쳤|빗나|될 만|될 수|될 뻔|뻔했|저지|막아|막았|막혔|막힌|선방|노리|노린");
    /**
     * 낱말 바로 뒤에 붙으면 그 일이 일어나지 않은 것("득점 시도와 오프사이드", "득점 기회"). 바로 뒤만 본다 —
     * "회전 점프를 시도합니다"처럼 동사로 쓰면 실제로 한 일이다
     */
    private static final Pattern ATTEMPT = Pattern.compile("\\s?(?:시도|기회)");
    /** 검색어가 시도·막힘을 찾는 말이면("슈팅 시도 장면", "골키퍼 선방") 그런 문장을 빼지 않는다 */
    private static final Pattern QUERY_ATTEMPT = Pattern.compile("시도|막아|막았|막는|막힌|막혔|선방|저지|노리|노린|뻔");
    /** 하이라이트가 같은 순간을 다시 보여 주는 장면(목차 제목) */
    private static final Pattern REPLAY = Pattern.compile("리플레이|다시 ?보기|느린 화면|슬로 ?모션");
    /** 리플레이 장면은 이 시간 안 앞에 같은 일을 찾은 후보가 있으면 뺀다 */
    static final int REPLAY_WINDOW_MS = 60_000;
    /** 검색어 어절이 이 말로 시작하면 검색어 자체가 부정을 말하는 것 */
    private static final Pattern QUERY_NEGATION = Pattern.compile("^(?:못|않|아니|안됐|안된|안되|안들|실패|무산|놓치|놓친|놓쳤|빗나)");
    /** 낱말 앞에 오면 그 순간이 아니라 요약·기록을 말하는 것일 수 있음 */
    private static final Pattern SUMMARY_TALK = Pattern.compile("오늘|지금까지|이번 경기|이번 시즌|시즌|통산|기록|몇 개|몇 번");
    private static final Pattern CLAUSE_END = Pattern.compile("[.!?,~…]");

    private static final Pattern SPLIT = Pattern.compile("[^0-9a-zA-Z가-힣]+");
    /** 뒤에서 뗄 조사·어미. 한 글자 어미(한·던·게·고·서)는 세 글자 이상 낱말에서만("만들고" → "만들", "광고"는 그대로) */
    private static final List<String> LONG_SUFFIXES = List.of("에서는", "으로는", "에서", "으로", "이랑", "하고", "까지", "부터",
            "에게", "한테", "처럼", "하는", "하던", "했던", "되는", "되던", "하게", "해서", "하기", "는지", "은지", "랑");
    private static final List<String> PARTICLES = List.of("은", "는", "이", "가", "을", "를", "에", "로", "와", "과", "의", "도", "만");
    private static final List<String> SHORT_ENDINGS = List.of("한", "던", "게", "고", "서");
    /** 합성어 끝 한 글자 낱말 뒤에 올 수 있는 조사·어미의 첫 글자: "선제골을", "헤더골로", "추가골입니다", "쐐기골까지" */
    private static final String COMPOUND_TAIL = "은는이가을를에로와과의도만입인으까부처랑하";
    private static final Set<String> STOPWORDS = Set.of("장면", "부분", "데", "곳", "때", "거", "것", "다시", "그", "저", "이",
            "아까", "보고", "싶어", "싶", "찾아", "줘", "가줘", "가자", "가", "이동", "보여", "보여줘", "나오", "나온", "나왔",
            "있", "있는", "하", "좀", "한번", "번", "더", "영상", "거기", "쪽", "다", "해", "할", "한", "되", "했", "가요", "주세요",
            "넘어가", "친", "치는", "순간", "당한", "당하는", "당했던", "하던", "나오는", "된", "됐", "될");
    /** 같은 일을 다르게 쓰는 말: 해설은 "골" 대신 "득점", "헤딩" 대신 "헤더"라고 쓸 때가 많다 */
    private static final Map<String, String> SYNONYMS = Map.of("골", "득점", "헤딩", "헤더", "헤더", "헤딩");
    /** 골을 말할 때 붙는 동사 — 해설은 "득점에 성공", "골망을 흔든다"처럼 '넣'이 없을 때가 많아 뺀다 */
    private static final Set<String> GOAL_TERMS = Set.of("골", "득점", "골인");
    /** "첫 골", "두 번째 골", "마지막 골" — 순서는 낱말로 찾지 않고 찾은 후보 중 시간순으로 고른다 */
    private static final Pattern ORDINAL = Pattern.compile(
            "(?<![가-힣\\d])(첫|두|세|네|다섯|여섯|일곱|여덟|아홉|열|\\d+)\\s*번째|(?<![가-힣])첫(?=\\s)|(?<![가-힣])마지막(?=\\s)");
    private static final Map<String, Integer> ORDINAL_NUMBERS = Map.of("첫", 1, "두", 2, "세", 3, "네", 4, "다섯", 5,
            "여섯", 6, "일곱", 7, "여덟", 8, "아홉", 9, "열", 10);
    /** 점수 "2대 0", "2:0", "2-0"은 한 낱말 "2:0"으로 본다 */
    private static final Pattern SCORE = Pattern.compile("(\\d+)\\s*(?:대|:|-)\\s*(\\d+)");
    private static final Pattern SCORE_TERM = Pattern.compile("\\d+:\\d+");

    private static final double KEYWORD = 3;
    private static final double TITLE = 3;
    private static final double SUMMARY = 2;
    private static final double SCENE = 1.5;
    private static final double MOMENT = 1.5;

    public enum Decision { SINGLE, MULTIPLE, NONE }

    private final boolean negationFilter;
    private final boolean evidenceBonus;

    public KeywordSceneScorer() {
        this(ChatTuningProperties.DEFAULT);
    }

    @Autowired
    public KeywordSceneScorer(ChatTuningProperties tuning) {
        this.negationFilter = tuning.seekNegationFilter();
        this.evidenceBonus = tuning.seekEvidenceBonus();
    }

    /**
     * 후보 한 곳
     *
     * @param targetMs 이동할 시각(목차에서 찾았으면 목차 시작, 문장에서 찾았으면 그 문장 2초 전)
     * @param snippet  문장에서 찾았으면 그 문장(후보를 읽어 줄 때 씀), 목차에서 찾았으면 목차 요약
     */
    public record Hit(SceneText scene, int targetMs, double score, int matchedTerms, Moment moment, String snippet,
                      int evidence) {
    }

    /** @param chosen SINGLE이면 1개, MULTIPLE이면 전부(지금 이후부터 시간순), NONE이면 비어 있음 */
    public record Result(List<String> terms, List<Hit> hits, Decision decision, List<Hit> chosen) {
    }

    public Result score(String query, List<SceneText> scenes, Integer nowMs) {
        List<String> terms = terms(query);
        if (terms.isEmpty() || scenes.isEmpty()) {
            return new Result(terms, List.of(), Decision.NONE, List.of());
        }
        double[] idf = idf(terms, scenes);
        // 검색어 자체가 부정·요약을 말하면("패스 못 받는 장면", "시즌 첫 홈런") 그 문장을 빼거나 깎지 않는다
        String loweredQuery = lower(query);
        boolean dropNegated = negationFilter && !negates(loweredQuery) && !QUERY_ATTEMPT.matcher(loweredQuery).find();
        boolean penalizeSummary = negationFilter && !SUMMARY_TALK.matcher(loweredQuery).find();
        List<Hit> hits = new ArrayList<>();
        for (SceneText scene : scenes) {
            Fields fields = new Fields(scene);
            double chapterScore = 0;
            Set<Integer> chapterMatched = new HashSet<>();
            for (int i = 0; i < terms.size(); i++) {
                double w = fields.weight(terms.get(i), dropNegated);
                if (w > 0) {
                    chapterScore += w * idf[i];
                    chapterMatched.add(i);
                }
            }
            boolean momentHit = false;
            for (Moment moment : scene.moments()) {
                String text = lower(moment.text());
                double score = 0;
                Set<Integer> matched = new HashSet<>(chapterMatched);
                int own = 0;
                for (int i = 0; i < terms.size(); i++) {
                    if (contains(text, terms.get(i))) {
                        score += MOMENT * idf[i];
                        matched.add(i);
                        own++;
                    }
                }
                // 문장 자체가 낱말 절반 이상을 말해야 후보: 목차에 "라면 사리"가 있다고 같은 장면의 "김치를 넣는다"가
                // "라면 사리 넣는"에 다 맞는 것으로 치지 않게(세 낱말 이상 검색어에서만 달라진다)
                if (own > 0 && own * 2 >= terms.size() && covers(matched.size(), terms.size())) {
                    if (dropNegated && negated(text, terms)) {
                        continue;
                    }
                    if (penalizeSummary && summarizing(text, terms)) {
                        score *= SUMMARY_PENALTY;
                    }
                    momentHit = true;
                    int target = Math.max(scene.startMs(), moment.startMs() - LEAD_MS);
                    hits.add(new Hit(scene, target, score + chapterScore / 2, matched.size(), moment, moment.text(), 1));
                }
            }
            if (!momentHit && chapterScore > 0 && covers(chapterMatched.size(), terms.size())) {
                hits.add(new Hit(scene, scene.startMs(), chapterScore, chapterMatched.size(), null, scene.summary(), 1));
            }
        }
        List<Hit> merged = merge(hits, evidenceBonus);
        if (!REPLAY.matcher(loweredQuery).find()) {
            merged = dropReplays(merged);
        }
        merged.sort(Comparator.comparingDouble(Hit::score).reversed());
        return decide(terms, merged, nowMs);
    }

    /**
     * 리플레이 장면 후보는 1분 안 앞에 리플레이가 아닌 후보가 있으면 뺀다 — 하이라이트는 골 장면을 바로 다시 보여 주므로
     * "골 장면"이 같은 골을 두 번 고르게 하지 않는다. 앞 후보가 없으면(리플레이에만 나온 순간) 남긴다
     */
    static List<Hit> dropReplays(List<Hit> hits) {
        List<Hit> originals = hits.stream().filter(h -> !isReplay(h)).toList();
        return new ArrayList<>(hits.stream().filter(h -> !isReplay(h) || originals.stream().noneMatch(o ->
                o.targetMs() < h.targetMs() && h.targetMs() - o.targetMs() <= REPLAY_WINDOW_MS)).toList());
    }

    private static boolean isReplay(Hit hit) {
        return REPLAY.matcher(lower(hit.scene().title())).find();
    }

    /**
     * LLM이 고른 장면 안에서 검색어와 가장 많이 겹치는 문장의 시각(2초 전)으로. 겹치는 문장이 없으면 목차 시작
     */
    public Hit locate(String query, SceneText scene) {
        List<String> terms = terms(query);
        Moment best = null;
        int bestMatched = 0;
        for (Moment moment : scene.moments()) {
            String text = lower(moment.text());
            int matched = (int) terms.stream().filter(t -> contains(text, t)).count();
            if (matched > bestMatched) {
                best = moment;
                bestMatched = matched;
            }
        }
        if (best == null) {
            return new Hit(scene, scene.startMs(), 0, 0, null, scene.summary(), 1);
        }
        return new Hit(scene, Math.max(scene.startMs(), best.startMs() - LEAD_MS), 0, bestMatched, best, best.text(), 1);
    }

    /** 지금 시각 이후를 먼저, 각각 시간순 */
    public static List<Hit> sortByTime(List<Hit> hits, Integer nowMs) {
        return byTime(hits, nowMs);
    }

    private static Result decide(List<String> terms, List<Hit> hits, Integer nowMs) {
        if (hits.isEmpty()) {
            return new Result(terms, hits, Decision.NONE, List.of());
        }
        List<Hit> full = hits.stream().filter(h -> h.matchedTerms() == terms.size()).toList();
        if (full.size() >= 2) {
            return new Result(terms, hits, Decision.MULTIPLE, byTime(full, nowMs));
        }
        Hit top = hits.get(0);
        if (hits.size() == 1 || top.score() >= hits.get(1).score() * MARGIN) {
            return new Result(terms, hits, Decision.SINGLE, List.of(top));
        }
        List<Hit> comparable = hits.stream().filter(h -> h.score() * MARGIN > top.score()).toList();
        return new Result(terms, hits, Decision.MULTIPLE, byTime(comparable, nowMs));
    }

    /** 지금 시각 이후를 먼저, 각각 시간순 */
    private static List<Hit> byTime(List<Hit> hits, Integer nowMs) {
        int now = nowMs == null ? 0 : nowMs;
        return hits.stream()
                .sorted(Comparator.<Hit>comparingInt(h -> h.targetMs() >= now ? 0 : 1).thenComparingInt(Hit::targetMs))
                .toList();
    }

    /**
     * 15초 안에 이어진 후보(캐스터가 "안타!"를 외치고 화면에도 뜬 경우)는 가장 이른 시각 하나로 합친다. 대표 문장은 점수가 가장 높은 것,
     * 점수는 가장 높은 점수에 겹친 자료 종류(대사·해설 문장·화면 글자)마다 30%를 더한 것
     */
    private static List<Hit> merge(List<Hit> hits, boolean evidenceBonus) {
        List<Hit> byTime = hits.stream().sorted(Comparator.comparingInt(Hit::targetMs)).toList();
        List<List<Hit>> groups = new ArrayList<>();
        for (Hit hit : byTime) {
            List<Hit> last = groups.isEmpty() ? null : groups.get(groups.size() - 1);
            // 같은 장면 안에서만 합친다(장면 경계를 넘으면 시각은 앞 장면, 장면 정보는 뒤 장면이 되어 섞였다)
            if (last != null && hit.scene().equals(last.get(0).scene())
                    && hit.targetMs() - last.get(0).targetMs() <= MERGE_WINDOW_MS) {
                last.add(hit);
            } else {
                groups.add(new ArrayList<>(List.of(hit)));
            }
        }
        List<Hit> merged = new ArrayList<>();
        for (List<Hit> group : groups) {
            Hit best = group.stream().max(Comparator.comparingDouble(Hit::score)).orElseThrow();
            // 목차 후보(moment 없음)는 자료 종류로 세지 않는다
            int evidence = Math.max(1, (int) group.stream().filter(h -> h.moment() != null)
                    .map(h -> h.moment().type()).distinct().count());
            int matched = group.stream().mapToInt(Hit::matchedTerms).max().orElse(0);
            double score = evidenceBonus ? best.score() * (1 + EVIDENCE_BONUS * (evidence - 1)) : best.score();
            merged.add(new Hit(best.scene(), group.get(0).targetMs(), score, matched, best.moment(), best.snippet(), evidence));
        }
        return merged;
    }

    /** 맞은 낱말 바로 뒤(같은 마디)에 부정 표현이 있으면 true: "안타가 하나도 없네요" → true, "아웃 아니고 안타!" → false */
    static boolean negated(String text, List<String> terms) {
        for (String term : withSynonyms(terms)) {
            int at = indexOf(text, term);
            if (at < 0) {
                continue;
            }
            // 끝 글자를 뗀 앞부분으로 맞았으면(indexOf) 실제로 맞은 길이만큼만 건너뛴다(문장 끝이면 범위를 넘어 예외가 났다)
            int from = at + (text.startsWith(term, at) ? term.length() : term.length() - 1);
            String after = text.substring(from, Math.min(text.length(), from + 12));
            if (ATTEMPT.matcher(after).lookingAt()) {
                return true;
            }
            var end = CLAUSE_END.matcher(after);
            if (end.find()) {
                after = after.substring(0, end.start());
            }
            if (NEGATION.matcher(after).find()) {
                return true;
            }
        }
        return false;
    }

    /**
     * 검색어 자체가 부정을 말하는지("패스 못 받는", "골이 없는"). 낱말 속 글자("연못", "집 안 장면")로 켜지지 않게
     * 어절 첫머리의 부정 말과 '없'만 본다
     */
    static boolean negates(String query) {
        String[] words = query.strip().split("\\s+");
        for (int i = 0; i < words.length; i++) {
            String word = words[i];
            if (word.equals("안")) {
                // "골이 안 들어간"은 부정, "집 안 장면"·"차 안"은 장소
                if (i + 1 < words.length && !words[i + 1].startsWith("장면") && !words[i + 1].startsWith("쪽")) {
                    return true;
                }
                continue;
            }
            if (QUERY_NEGATION.matcher(word).find() || word.contains("없") || word.contains("지못") || word.contains("지않")) {
                return true;
            }
        }
        return false;
    }

    /** 맞은 낱말 앞에 요약·기록하는 말이 있으면 true: "오늘 안타가 3개째" → true */
    static boolean summarizing(String text, List<String> terms) {
        for (String term : withSynonyms(terms)) {
            int at = indexOf(text, term);
            if (at > 0 && SUMMARY_TALK.matcher(text.substring(0, at)).find()) {
                return true;
            }
        }
        return false;
    }

    private static List<String> withSynonyms(List<String> terms) {
        List<String> all = new ArrayList<>(terms);
        terms.stream().map(SYNONYMS::get).filter(s -> s != null && !all.contains(s)).forEach(all::add);
        return all;
    }

    private static int indexOf(String text, String term) {
        int at = text.indexOf(term);
        if (at < 0 && term.length() >= 3) {
            at = text.indexOf(term.substring(0, term.length() - 1));
        }
        return at;
    }

    /** 낱말이 절반 넘게 맞아야 후보 */
    private static boolean covers(int matched, int termCount) {
        return matched * 2 > termCount;
    }

    private static double[] idf(List<String> terms, List<SceneText> scenes) {
        List<Fields> fields = scenes.stream().map(Fields::new).toList();
        return terms.stream().mapToDouble(term -> {
            long df = 0;
            for (int i = 0; i < scenes.size(); i++) {
                if (fields.get(i).weight(term, false) > 0
                        || scenes.get(i).moments().stream().anyMatch(m -> contains(lower(m.text()), term))) {
                    df++;
                }
            }
            return df == 0 ? 0 : Math.log(1 + (double) scenes.size() / df);
        }).toArray();
    }

    static List<String> terms(String query) {
        Set<String> terms = new LinkedHashSet<>();
        String q = withoutOrdinal(query).toLowerCase(Locale.ROOT);
        Matcher score = SCORE.matcher(q);
        while (score.find()) {
            terms.add(score.group(1) + ":" + score.group(2));
        }
        for (String token : SPLIT.split(SCORE.matcher(q).replaceAll(" "))) {
            String term = strip(token);
            if (!term.isEmpty() && !STOPWORDS.contains(term) && !STOPWORDS.contains(token)) {
                terms.add(term);
            }
        }
        if (terms.stream().anyMatch(GOAL_TERMS::contains)) {
            terms.remove("넣");
        }
        return List.copyOf(terms);
    }

    /**
     * 목차 제목이 검색어 낱말을 모두 담았고(두 글자 이상 낱말이 둘 이상) 부정·시도가 아니면 true.
     * RAG 확인에서 LLM이 하나도 고르지 않았을 때 이런 곳만은 믿고 보여 준다("9회 말 수비" → "9회 말 … 다이빙 캐치 수비")
     */
    public static boolean titleCovers(List<String> terms, SceneText scene) {
        String title = lower(scene.title());
        return terms.stream().filter(t -> t.length() >= 2).count() >= 2
                && terms.stream().allMatch(t -> contains(title, t))
                && !negated(title, terms);
    }

    /** 순서 말을 뺀 검색어("두 번째 골" → "골"). 순서 말만 있으면 그대로 */
    static String withoutOrdinal(String query) {
        Matcher m = ORDINAL.matcher(query);
        if (!m.find()) {
            return query;
        }
        String rest = (query.substring(0, m.start()) + " " + query.substring(m.end())).strip();
        return rest.isEmpty() ? query : rest;
    }

    /**
     * 검색어에 순서 말("첫 골", "두 번째 골", "마지막 골")이 있고 후보가 여럿이면 시간순으로 그 번째 하나만.
     * 순서 말이 없거나, 후보가 하나뿐이거나, 그 번째가 없으면 그대로
     */
    public static List<Hit> pickOrdinal(String query, List<Hit> hits) {
        Matcher m = ORDINAL.matcher(query);
        if (hits.size() < 2 || !m.find() || withoutOrdinal(query).equals(query)) {
            return hits;
        }
        String word = m.group(1) != null ? m.group(1) : m.group();
        int nth = word.equals("마지막") ? hits.size()
                : ORDINAL_NUMBERS.getOrDefault(word, word.chars().allMatch(Character::isDigit) ? Integer.parseInt(word) : 0);
        if (nth < 1 || nth > hits.size()) {
            return hits;
        }
        return List.of(hits.stream().sorted(Comparator.comparingInt(Hit::targetMs)).toList().get(nth - 1));
    }

    /** 조사·어미를 뒤에서부터 뗀다(두 번까지, 한 글자는 남김): "차가" → "차", "튀기는" → "튀기", "만들고" → "만들" */
    static String strip(String token) {
        String t = token;
        for (int round = 0; round < 2; round++) {
            String next = stripOnce(t);
            if (next.equals(t)) {
                break;
            }
            t = next;
        }
        return t;
    }

    private static String stripOnce(String t) {
        for (String suffix : LONG_SUFFIXES) {
            if (t.length() > suffix.length() && t.endsWith(suffix)) {
                return t.substring(0, t.length() - suffix.length());
            }
        }
        for (String suffix : PARTICLES) {
            if (t.length() >= 2 && t.endsWith(suffix)) {
                return t.substring(0, t.length() - 1);
            }
        }
        for (String suffix : SHORT_ENDINGS) {
            if (t.length() >= 3 && t.endsWith(suffix)) {
                return t.substring(0, t.length() - 1);
            }
        }
        return t;
    }

    /**
     * 글에 낱말이 있는지. 한 글자("차", "골")는 낱말 맨 앞이나 세 글자 이상 합성어 끝에서만("골키퍼", "선제골을", "자동차가"),
     * 세 글자 이상은 끝 한 글자를 뗀 것도("뒤집히" → "뒤집"), 끝 글자 모음이 줄어든 꼴도("튀기" → "튀겨")
     */
    static boolean contains(String text, String term) {
        if (SCORE_TERM.matcher(term).matches()) {
            return Pattern.compile("(?<!\\d)" + Pattern.quote(term) + "(?!\\d)")
                    .matcher(SCORE.matcher(text).replaceAll("$1:$2")).find();
        }
        if (containsWord(text, term)) {
            return true;
        }
        String synonym = SYNONYMS.get(term);
        return synonym != null && containsWord(text, synonym);
    }

    private static boolean containsWord(String text, String term) {
        if (term.length() == 1) {
            for (String word : SPLIT.split(text)) {
                if (word.startsWith(term) || endsCompound(word, term)) {
                    return true;
                }
            }
            return false;
        }
        if (text.contains(term) || (term.length() >= 3 && text.contains(term.substring(0, term.length() - 1)))) {
            return true;
        }
        String contracted = contracted(term);
        return contracted != null && text.contains(contracted);
    }

    /**
     * 한 글자 낱말이 두 글자 이상 말 뒤에 붙은 합성어의 끝인지: "선제골을"·"헤더골입니다"(골), "자동차가"(차).
     * 두 글자 말("시골", "모양", "다양한", "배우")은 한 낱말이라 빼서 이런 말 끝에 우연히 걸리지 않게 한다
     */
    static boolean endsCompound(String word, String term) {
        for (int i = word.indexOf(term, 2); i >= 0; i = word.indexOf(term, i + 1)) {
            if (i == word.length() - 1 || COMPOUND_TAIL.indexOf(word.charAt(i + 1)) >= 0) {
                return true;
            }
        }
        return false;
    }

    /**
     * 받침 없는 끝 글자의 ㅣ·ㅗ·ㅜ가 어미와 줄어든 꼴: "튀기" → "튀겨", "나오" → "나와", "세우" → "세워". 없으면 null.
     * ㅡ는 앞 모음에 따라 갈리고(아프 → 아파, 슬프 → 슬퍼) "버스"·"소스" 같은 낱말이 많아 뺀다
     */
    static String contracted(String term) {
        char last = term.charAt(term.length() - 1);
        if (last < '가' || last > '힣' || (last - '가') % 28 != 0) {
            return null;
        }
        int syllable = (last - '가') / 28;
        int vowel = switch (syllable % 21) {
            case 20 -> 6;
            case 8 -> 9;
            case 13 -> 14;
            default -> -1;
        };
        if (vowel < 0) {
            return null;
        }
        return term.substring(0, term.length() - 1) + (char) ('가' + (syllable - syllable % 21 + vowel) * 28);
    }

    private static String lower(String s) {
        return s == null ? "" : s.toLowerCase(Locale.ROOT);
    }

    /** 목차 칸(키워드·제목·요약·장면 설명) */
    private static final class Fields {
        private final List<String> keywords;
        private final String title;
        private final String summary;
        private final String sceneDescription;

        private Fields(SceneText scene) {
            this.keywords = scene.keywords().stream().map(k -> k.toLowerCase(Locale.ROOT)).toList();
            this.title = lower(scene.title());
            this.summary = lower(scene.summary());
            this.sceneDescription = lower(scene.sceneDescription());
        }

        /** @param dropNegated 제목·요약·장면 설명에서 낱말 뒤가 부정·시도면("득점 시도와 오프사이드") 맞지 않은 것으로 */
        double weight(String term, boolean dropNegated) {
            if (term.length() == 1 ? keywords.stream().anyMatch(k -> k.equals(term) || endsCompound(k, term))
                    : keywords.stream().anyMatch(k -> k.contains(term) || (k.length() >= 2 && term.contains(k)))) {
                return KEYWORD;
            }
            return matches(title, term, dropNegated) ? TITLE : matches(summary, term, dropNegated) ? SUMMARY
                    : matches(sceneDescription, term, dropNegated) ? SCENE : 0;
        }

        private static boolean matches(String field, String term, boolean dropNegated) {
            return contains(field, term) && !(dropNegated && negated(field, List.of(term)));
        }
    }
}
