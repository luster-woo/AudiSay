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
import java.util.Set;
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
    /** 낱말 뒤 같은 마디(문장부호 전, 12자 안)에 오면 그 일이 일어나지 않은 것 */
    private static final Pattern NEGATION = Pattern.compile("없|못|아니|안 |실패|무산|놓치|놓쳤|빗나");
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
    private static final Set<String> STOPWORDS = Set.of("장면", "부분", "데", "곳", "때", "거", "것", "다시", "그", "저", "이",
            "아까", "보고", "싶어", "싶", "찾아", "줘", "가줘", "가자", "가", "이동", "보여", "보여줘", "나오", "나온", "나왔",
            "있", "있는", "하", "좀", "한번", "번", "더", "영상", "거기", "쪽", "다", "해", "할", "한", "되", "했", "가요", "주세요",
            "넘어가", "친", "치는", "순간", "당한", "당하는", "당했던", "하던", "나오는");

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
        boolean dropNegated = negationFilter && !negates(loweredQuery);
        boolean penalizeSummary = negationFilter && !SUMMARY_TALK.matcher(loweredQuery).find();
        List<Hit> hits = new ArrayList<>();
        for (SceneText scene : scenes) {
            Fields fields = new Fields(scene);
            double chapterScore = 0;
            Set<Integer> chapterMatched = new HashSet<>();
            for (int i = 0; i < terms.size(); i++) {
                double w = fields.weight(terms.get(i));
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
                boolean any = false;
                for (int i = 0; i < terms.size(); i++) {
                    if (contains(text, terms.get(i))) {
                        score += MOMENT * idf[i];
                        matched.add(i);
                        any = true;
                    }
                }
                if (any && covers(matched.size(), terms.size())) {
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
        merged.sort(Comparator.comparingDouble(Hit::score).reversed());
        return decide(terms, merged, nowMs);
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
        for (String term : terms) {
            int at = indexOf(text, term);
            if (at < 0) {
                continue;
            }
            // 끝 글자를 뗀 앞부분으로 맞았으면(indexOf) 실제로 맞은 길이만큼만 건너뛴다(문장 끝이면 범위를 넘어 예외가 났다)
            int from = at + (text.startsWith(term, at) ? term.length() : term.length() - 1);
            String after = text.substring(from, Math.min(text.length(), from + 12));
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
        for (String term : terms) {
            int at = indexOf(text, term);
            if (at > 0 && SUMMARY_TALK.matcher(text.substring(0, at)).find()) {
                return true;
            }
        }
        return false;
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
                if (fields.get(i).weight(term) > 0
                        || scenes.get(i).moments().stream().anyMatch(m -> contains(lower(m.text()), term))) {
                    df++;
                }
            }
            return df == 0 ? 0 : Math.log(1 + (double) scenes.size() / df);
        }).toArray();
    }

    static List<String> terms(String query) {
        Set<String> terms = new LinkedHashSet<>();
        for (String token : SPLIT.split(query.toLowerCase(Locale.ROOT))) {
            String term = strip(token);
            if (!term.isEmpty() && !STOPWORDS.contains(term) && !STOPWORDS.contains(token)) {
                terms.add(term);
            }
        }
        return List.copyOf(terms);
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
     * 글에 낱말이 있는지. 한 글자("차", "양")는 낱말 맨 앞에서만, 세 글자 이상은 끝 한 글자를 뗀 것도("뒤집히" → "뒤집"),
     * 끝 글자 모음이 줄어든 꼴도("튀기" → "튀겨")
     */
    static boolean contains(String text, String term) {
        if (term.length() == 1) {
            for (String word : SPLIT.split(text)) {
                if (word.startsWith(term)) {
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

        double weight(String term) {
            if (term.length() == 1 ? keywords.contains(term)
                    : keywords.stream().anyMatch(k -> k.contains(term) || (k.length() >= 2 && term.contains(k)))) {
                return KEYWORD;
            }
            return contains(title, term) ? TITLE : contains(summary, term) ? SUMMARY
                    : contains(sceneDescription, term) ? SCENE : 0;
        }
    }
}
