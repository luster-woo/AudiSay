package com.audisay.domain.chat.eval;

import com.audisay.domain.chat.entity.ChatIntent;
import com.audisay.domain.chat.intent.ClassifiedIntent;
import com.audisay.domain.chat.intent.LlmIntentClassifier;
import com.audisay.domain.chat.intent.RuleIntentClassifier;
import com.audisay.domain.chat.ratelimit.ChatRateLimiter;
import com.audisay.domain.chat.search.SceneSearchProperties;
import com.audisay.domain.chat.search.SceneSourceLine;
import com.audisay.domain.chat.search.SceneVectorSearch;
import com.audisay.domain.chat.search.VectorLine;
import com.audisay.domain.chat.seek.KeywordSceneScorer;
import com.audisay.domain.chat.seek.KeywordSceneScorer.Hit;
import com.audisay.domain.chat.seek.LlmHitVerifier;
import com.audisay.domain.chat.seek.LlmSceneSelector;
import com.audisay.domain.chat.seek.SceneSeeker;
import com.audisay.domain.chat.tuning.ChatTuningProperties;
import com.audisay.domain.description.service.SceneText;
import com.audisay.domain.description.service.SceneTextReader;
import com.audisay.domain.description.service.ScreenTextTiming;
import com.audisay.global.aicall.AiCallLog;
import com.audisay.global.aicall.AiCallRecorder;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.external.embedding.EmbeddingProperties;
import com.audisay.global.external.embedding.GmsEmbeddingClient;
import com.audisay.global.external.llm.DeltaHandler;
import com.audisay.global.external.llm.GmsProperties;
import com.audisay.global.external.llm.LlmClient;
import com.audisay.global.external.llm.LlmException;
import com.audisay.global.external.llm.LlmProvider;
import com.audisay.global.external.llm.LlmRequest;
import com.audisay.global.external.llm.LlmResult;
import com.audisay.global.external.llm.claude.ClaudeLlmProvider;
import com.audisay.global.external.llm.gemini.GeminiLlmProvider;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;

import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 285 챗봇 평가 러너(GMS 크레딧 사용). CHAT_EVAL=1일 때만 돈다. 서버·DB 없이 실제 분류기·장면 찾기 코드를 조합별로 돌린다.
 * 실행(backend 폴더): CHAT_EVAL=1 ./gradlew test --tests 'com.audisay.domain.chat.eval.ChatEvalTest'
 * 환경 변수(모두 선택): CHAT_EVAL_MODELS(기본 gemini-3.1-flash-lite,claude-haiku-5-5), CHAT_EVAL_RUNS(기본 1),
 * CHAT_EVAL_LIMIT(세트마다 앞 N개), CHAT_EVAL_PART(intent,seek), CHAT_EVAL_SLEEP_MS(GMS 호출 사이 쉼, 기본 2000 — 팀 키 분당 한도 보호, h200은 0),
 * CHAT_EVAL_DIR(기본 build/eval), GMS_API_KEY(없으면 레포 루트 .env).
 * 모델 이름 h200 = H200 평가 서버(build/eval/h200/gen.py, CHAT_EVAL_H200_URL 기본 http://127.0.0.1:8101, 토큰 H200_TOKEN)
 * 장면 찾기 RAG(342): CHAT_EVAL_SEEK_MODES(기본 OFF, 예 OFF,FALLBACK,ALWAYS) — OFF가 아니면 scenes.json 줄을 실제 임베딩
 * (text-embedding-3-large)해 메모리에서 검색. 확인용 평가셋 CHAT_EVAL_HOLDOUT(기본 {CHAT_EVAL_DIR}/rag/holdout_v1.json, 있으면)도 같이 돈다.
 * 입력 eval_285.json·scenes.json, 결과 {CHAT_EVAL_DIR}/results/{시각}-junit/summary.md·intent.csv·seek.csv
 */
@EnabledIfEnvironmentVariable(named = "CHAT_EVAL", matches = "1")
class ChatEvalTest {
    private static final String GEMINI_URL = "https://gms.ssafy.io/gmsapi/generativelanguage.googleapis.com";
    private static final String ANTHROPIC_URL = "https://gms.ssafy.io/gmsapi/api.anthropic.com";
    private static final Map<String, double[]> PRICES = Map.of(
            "gemini-3.1-flash-lite", new double[]{0.0025, 0.015},
            "gemini-3.5-flash-lite", new double[]{0.003, 0.025},
            "gemini-3.8-flash", new double[]{0.015, 0.075},
            "claude-haiku-5-5", new double[]{0.001, 0.005});
    private static final int WINDOW_LEAD_MS = 5000;

    private final ObjectMapper om = JsonMapper.builder().build();
    /** CHAT_EVAL_PROD_ONLY=1: 운영 조합(분류 규칙+LLM, 장면 찾기 전부 켬)만. 비싼 모델을 적은 호출로 잴 때 */
    private boolean prodOnly;

    @Test
    void 평가() throws IOException {
        Path dir = Path.of(env("CHAT_EVAL_DIR", "build/eval"));
        EvalSet set = om.readValue(Files.readString(dir.resolve("eval_285.json")), EvalSet.class);
        ScenesFile scenesFile = om.readValue(Files.readString(dir.resolve("scenes.json")), ScenesFile.class);
        List<String> models = Arrays.stream(env("CHAT_EVAL_MODELS", "gemini-3.1-flash-lite,claude-haiku-5-5").split(","))
                .map(String::strip).filter(s -> !s.isEmpty()).toList();
        int runs = Integer.parseInt(env("CHAT_EVAL_RUNS", "1"));
        int limit = Integer.parseInt(env("CHAT_EVAL_LIMIT", "100000"));
        List<String> parts = List.of(env("CHAT_EVAL_PART", "intent,seek").split(","));
        long sleepMs = Long.parseLong(env("CHAT_EVAL_SLEEP_MS", "2000"));
        prodOnly = "1".equals(env("CHAT_EVAL_PROD_ONLY", "0"));
        List<SceneSearchProperties.Mode> seekModes = Arrays.stream(env("CHAT_EVAL_SEEK_MODES", "OFF").split(","))
                .map(String::strip).filter(m -> !m.isEmpty()).map(SceneSearchProperties.Mode::valueOf).toList();
        Path holdoutPath = Path.of(env("CHAT_EVAL_HOLDOUT", dir.resolve("rag/holdout_v1.json").toString()));
        List<SeekCase> holdout = Files.exists(holdoutPath)
                ? om.readValue(Files.readString(holdoutPath), EvalSet.class).seek().stream()
                .map(c -> c.tags() == null ? new SeekCase(c.id(), c.videoId(), c.nowMs(), c.query(), c.kind(), c.windows(),
                        c.allowNone(), List.of("holdout")) : c)
                .toList()
                : List.of();
        String key = apiKey();
        String h200Token = models.contains("h200") ? envOrDotEnv("H200_TOKEN") : null;

        List<VideoData> videos = new ArrayList<>(scenesFile.videos());
        if (set.extraVideos() != null) {
            videos.addAll(set.extraVideos());
        }
        Map<Long, Long> descriptionOf = new HashMap<>();
        Map<Long, List<SceneText>> scenesOf = new HashMap<>();
        for (VideoData v : videos) {
            descriptionOf.put(v.videoId(), v.descriptionId());
            // 운영 SceneTextReader와 같이 화면 글자를 해설·대사가 읽은 시각으로
            scenesOf.put(v.descriptionId(), v.scenes() == null ? List.of()
                    : v.scenes().stream().map(ScreenTextTiming::retime).toList());
        }

        Path out = dir.resolve("results").resolve(
                LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss")) + "-junit");
        Files.createDirectories(out);
        Report report = new Report();
        report.line("# 285 평가 결과 (JUnit 러너)");
        report.line("");
        report.line("- 시각 " + LocalDateTime.now() + ", 평가셋 " + set.version() + ", 모델 " + models + ", 반복 " + runs
                + (limit < 100000 ? ", 세트마다 앞 " + limit + "개" : "") + (prodOnly ? ", 운영 조합만" : "")
                + ", 장면 찾기 RAG 모드 " + seekModes + ", 확인용 " + holdout.size() + "문항");
        InMemoryVectorSearch vectorSearch = parts.contains("seek")
                && seekModes.stream().anyMatch(m -> m != SceneSearchProperties.Mode.OFF)
                ? new InMemoryVectorSearch(key, scenesOf) : null;

        for (String model : models) {
            LlmProvider provider = model.equals("h200")
                    ? new H200Provider(env("CHAT_EVAL_H200_URL", "http://127.0.0.1:8101"), h200Token, om)
                    : provider(model, key);
            RecordingClient client = new RecordingClient(provider, model, model.equals("h200") ? 0 : sleepMs);
            if (parts.contains("intent")) {
                runIntent(set.intent().subList(0, Math.min(limit, set.intent().size())), client, runs, report);
            }
            if (parts.contains("seek")) {
                for (SceneSearchProperties.Mode mode : seekModes) {
                    runSeek("개발", mode, vectorSearch, set.seek().subList(0, Math.min(limit, set.seek().size())), client,
                            runs, report, descriptionOf, scenesOf);
                    if (!holdout.isEmpty()) {
                        runSeek("확인", mode, vectorSearch, holdout.subList(0, Math.min(limit, holdout.size())), client,
                                runs, report, descriptionOf, scenesOf);
                    }
                }
            }
        }
        Files.writeString(out.resolve("summary.md"), report.summary(), StandardCharsets.UTF_8);
        Files.writeString(out.resolve("intent.csv"), report.csv(report.intentRows), StandardCharsets.UTF_8);
        Files.writeString(out.resolve("seek.csv"), report.csv(report.seekRows), StandardCharsets.UTF_8);
        System.out.println(report.summary());
        System.out.println("[EVAL] 결과 " + out.toAbsolutePath());
    }

    // ---------------- 분류 ----------------

    private void runIntent(List<IntentCase> cases, RecordingClient client, int runs, Report report) {
        RuleIntentClassifier rule = new RuleIntentClassifier();
        LlmIntentClassifier llm = new LlmIntentClassifier(client, om);
        for (boolean rulesOn : prodOnly ? List.of(true) : List.of(true, false)) {
            String combo = rulesOn ? "규칙+LLM" : "LLM만";
            Stats stats = new Stats();
            Map<String, int[]> byIntent = new LinkedHashMap<>();
            List<String> failures = new ArrayList<>();
            Snapshot start = client.snapshot();
            for (int run = 1; run <= runs; run++) {
                for (IntentCase c : cases) {
                    progress(client, "분류 " + combo, cases.indexOf(c) + 1, cases.size());
                    Snapshot before = client.snapshot();
                    long t0 = System.nanoTime();
                    ClassifiedIntent got = null;
                    String source;
                    String error = null;
                    try {
                        got = rulesOn ? rule.classify(c.utterance()) : null;
                        source = got != null ? "RULE" : "LLM";
                        if (got == null) {
                            got = llm.classify(c.utterance(), null);
                        }
                    } catch (BusinessException e) {
                        source = "LLM";
                        error = e.getErrorCode().name();
                    }
                    Snapshot used = client.snapshot().minus(before);
                    long ms = (System.nanoTime() - t0) / 1_000_000 - used.sleptMs();
                    String expected = String.valueOf(c.expected().get("intent"));
                    boolean pending = !isKnownIntent(expected);
                    boolean ok = !pending && error == null && (matches(c.expected(), got) || alsoAccepted(c.alsoAccept(), got));
                    if (!pending) {
                        stats.add(ok, ms, "RULE".equals(source));
                        int[] counter = byIntent.computeIfAbsent(expected, k -> new int[2]);
                        counter[0]++;
                        counter[1] += ok ? 1 : 0;
                        if (!ok && run == 1) {
                            failures.add(c.id() + " \"" + c.utterance() + "\" 기대 " + c.expected() + " → " + describe(got, error));
                        }
                    }
                    report.intentRows.add(List.of(client.model(), combo, String.valueOf(run), c.id(), c.utterance(), expected,
                            describe(got, error), pending ? "PENDING" : ok ? "OK" : "FAIL", source, String.valueOf(ms),
                            String.valueOf(used.calls()), fmt(used.credits()), String.join("|", c.tags())));
                }
            }
            Snapshot total = client.snapshot().minus(start);
            report.line("");
            report.line("## 분류 · " + client.model() + " · " + combo);
            report.line("");
            report.line(String.format(Locale.ROOT, "- 정확도 **%.1f%%** (%d/%d), 규칙 처리 %.1f%%, 지연 p50 %dms · p95 %dms, LLM 호출 %d(실패 %d, 429 재시도 %d), 크레딧 %s",
                    stats.accuracy(), stats.ok, stats.n, stats.ruleShare(), stats.percentile(50), stats.percentile(95),
                    total.calls(), total.errors(), total.retries(), fmt(total.credits())));
            report.line("");
            report.line("| intent | 정답/전체 |");
            report.line("|---|---|");
            byIntent.forEach((intent, v) -> report.line("| " + intent + " | " + v[1] + "/" + v[0] + " |"));
            if (!failures.isEmpty()) {
                report.line("");
                report.line("<details><summary>틀린 문항 " + failures.size() + "개 (1회차)</summary>");
                report.line("");
                failures.forEach(f -> report.line("- " + f));
                report.line("</details>");
            }
        }
    }

    private static boolean isKnownIntent(String name) {
        return Arrays.stream(ChatIntent.values()).anyMatch(i -> i.name().equals(name));
    }

    static boolean matches(Map<String, Object> expected, ClassifiedIntent got) {
        if (got == null || !got.intent().name().equals(String.valueOf(expected.get("intent")))) {
            return false;
        }
        for (Map.Entry<String, Object> e : expected.entrySet()) {
            Object v = e.getValue();
            boolean ok = switch (e.getKey()) {
                case "intent" -> true;
                case "targetMs" -> Objects.equals(got.targetMs(), ((Number) v).intValue());
                case "relativeMs" -> Objects.equals(got.relativeMs(), ((Number) v).intValue());
                case "toEnd" -> got.toEnd() == (Boolean) v;
                case "settingKey" -> Objects.equals(got.settingKey(), v);
                case "settingValue" -> Objects.equals(got.settingValue(), v);
                case "direction" -> got.direction() != null && got.direction().name().equals(v);
                case "actionCode" -> got.actionCode() != null && got.actionCode().name().equals(v);
                case "queryHas" -> got.query() != null && ((List<?>) v).stream().anyMatch(q -> got.query().contains(String.valueOf(q)));
                default -> true;
            };
            if (!ok) {
                return false;
            }
        }
        return true;
    }

    static boolean alsoAccepted(List<String> alsoAccept, ClassifiedIntent got) {
        if (got == null || alsoAccept == null) {
            return false;
        }
        for (String a : alsoAccept) {
            String[] p = a.split(":");
            if (got.intent().name().equals(p[0])
                    && (p.length == 1 || (got.actionCode() != null && got.actionCode().name().equals(p[1])))) {
                return true;
            }
        }
        return false;
    }

    private static String describe(ClassifiedIntent c, String error) {
        if (error != null) {
            return "ERROR " + error;
        }
        if (c == null) {
            return "null";
        }
        StringBuilder sb = new StringBuilder(c.intent().name());
        if (c.targetMs() != null) sb.append(" targetMs=").append(c.targetMs());
        if (c.relativeMs() != null) sb.append(" relativeMs=").append(c.relativeMs());
        if (c.toEnd()) sb.append(" toEnd");
        if (c.query() != null) sb.append(" q=").append(c.query());
        if (c.settingKey() != null) sb.append(" ").append(c.settingKey()).append("=")
                .append(c.settingValue() != null ? c.settingValue() : c.direction());
        if (c.actionCode() != null) sb.append(" ").append(c.actionCode());
        return sb.toString();
    }

    // ---------------- 장면 찾기 ----------------

    private record SeekCombo(String name, ChatTuningProperties tuning) {
    }

    private static final List<SeekCombo> SEEK_COMBOS = List.of(
            new SeekCombo("전부 켬(A·B 포함)", tuning(true, true, true, true, true, true)),
            new SeekCombo("A·B 끔(예전)", tuning(true, true, true, true, false, false)),
            new SeekCombo("A만(정확히 고르기)", tuning(true, true, true, true, true, false)),
            new SeekCombo("B만(낱말 확인)", tuning(true, true, true, true, false, true)),
            new SeekCombo("LLM만", tuning(false, true, true, true, true, true)),
            new SeekCombo("LLM만·A 끔", tuning(false, true, true, true, false, true)),
            new SeekCombo("키워드만(거르기 없음)", tuning(true, false, true, false, true, true)),
            new SeekCombo("키워드+부정 거르기", tuning(true, true, true, false, true, true)),
            new SeekCombo("겹침 가산 끔", tuning(true, true, false, true, true, true)));

    private static ChatTuningProperties tuning(boolean keyword, boolean negation, boolean evidence, boolean verify,
                                               boolean exact, boolean partial) {
        return new ChatTuningProperties(true, keyword, negation, evidence, verify, exact, partial, true, true);
    }

    private void runSeek(String setName, SceneSearchProperties.Mode mode, InMemoryVectorSearch vectorSearch,
                         List<SeekCase> cases, RecordingClient client, int runs, Report report,
                         Map<Long, Long> descriptionOf, Map<Long, List<SceneText>> scenesOf) {
        SceneTextReader reader = mock(SceneTextReader.class);
        when(reader.read(anyLong())).thenAnswer(inv -> scenesOf.getOrDefault(inv.<Long>getArgument(0), List.of()));
        ChatRateLimiter limiter = mock(ChatRateLimiter.class);
        for (SeekCombo combo : prodOnly ? SEEK_COMBOS.subList(0, 1) : SEEK_COMBOS) {
            KeywordSceneScorer scorer = new KeywordSceneScorer(combo.tuning());
            SceneSeeker seeker = new SceneSeeker(reader, scorer, new LlmSceneSelector(client, om, scorer, combo.tuning()),
                    new LlmHitVerifier(client, om, combo.tuning()), limiter, combo.tuning(), new SimpleMeterRegistry(),
                    mock(GmsProperties.class), vectorSearch == null ? NO_VECTOR : vectorSearch,
                    new SceneSearchProperties(null, new SceneSearchProperties.Search(mode, null, null), null));
            String comboName = setName + " · " + mode + " · " + combo.name();
            long embedTokensStart = vectorSearch == null ? 0 : vectorSearch.tokens;
            int embedQueriesStart = vectorSearch == null ? 0 : vectorSearch.queryCalls;
            Stats single = new Stats();
            Stats none = new Stats();
            double recallSum = 0;
            double precisionSum = 0;
            int multiple = 0;
            int allOk = 0;
            int all = 0;
            int wrongMove = 0;
            int noneButMoved = 0;
            int keywordSolved = 0;
            List<Long> latencies = new ArrayList<>();
            List<String> failures = new ArrayList<>();
            Snapshot start = client.snapshot();
            for (int run = 1; run <= runs; run++) {
                for (SeekCase c : cases) {
                    progress(client, "장면 " + comboName, cases.indexOf(c) + 1, cases.size());
                    Long descriptionId = descriptionOf.get(c.videoId());
                    Snapshot before = client.snapshot();
                    long t0 = System.nanoTime();
                    List<Hit> hits = List.of();
                    String source = "NONE";
                    String error = null;
                    try {
                        SceneSeeker.Outcome o = seeker.seek(1L, descriptionId, c.query(), null, c.nowMs());
                        hits = o.hits();
                        source = o.source() == null ? "NONE" : o.source().name();
                    } catch (BusinessException e) {
                        error = e.getErrorCode().name();
                    }
                    Snapshot used = client.snapshot().minus(before);
                    long ms = (System.nanoTime() - t0) / 1_000_000 - used.sleptMs();
                    latencies.add(ms);
                    final List<Hit> found = hits;

                    int correctHits = (int) found.stream().filter(h -> inAny(h.targetMs(), c.windows())).count();
                    long covered = c.windows().stream()
                            .filter(w -> found.stream().anyMatch(h -> in(h.targetMs(), w))).count();
                    boolean firstOk = !found.isEmpty() && inAny(found.getFirst().targetMs(), c.windows());
                    boolean ok = switch (c.kind()) {
                        case "SINGLE" -> firstOk;
                        case "MULTIPLE" -> covered == c.windows().size() && correctHits == found.size();
                        default -> found.isEmpty();
                    };
                    if (c.allowNone() && found.isEmpty()) {
                        ok = true;
                    }
                    ok = ok && error == null;
                    boolean moved = found.size() == 1;
                    boolean wrong = moved && !inAny(found.getFirst().targetMs(), c.windows());
                    all++;
                    allOk += ok ? 1 : 0;
                    wrongMove += wrong ? 1 : 0;
                    keywordSolved += "KEYWORD".equals(source) && used.calls() == 0 ? 1 : 0;
                    switch (c.kind()) {
                        case "SINGLE" -> single.add(ok, ms, false);
                        case "MULTIPLE" -> {
                            multiple++;
                            recallSum += c.windows().isEmpty() ? 1 : (double) covered / c.windows().size();
                            precisionSum += found.isEmpty() ? 0 : (double) correctHits / found.size();
                        }
                        default -> {
                            none.add(ok, ms, false);
                            noneButMoved += moved ? 1 : 0;
                        }
                    }
                    String got = error != null ? "ERROR " + error : found.stream()
                            .map(h -> h.targetMs() / 1000 + "s").toList().toString();
                    if (!ok && run == 1) {
                        failures.add(c.id() + " [" + c.kind() + "] \"" + c.query() + "\" 정답 " + windowsText(c.windows())
                                + " → " + got + " (" + source + ")");
                    }
                    report.seekRows.add(List.of(client.model(), comboName, String.valueOf(run), c.id(),
                            String.valueOf(c.videoId()), c.query(), c.kind(), windowsText(c.windows()), got, source,
                            ok ? "OK" : "FAIL", wrong ? "WRONG_MOVE" : "", String.valueOf(ms), String.valueOf(used.calls()),
                            fmt(used.credits()), String.join("|", c.tags())));
                }
            }
            Snapshot total = client.snapshot().minus(start);
            Stats lat = new Stats();
            latencies.forEach(ms -> lat.add(true, ms, false));
            report.line("");
            report.line("## 장면 찾기 · " + client.model() + " · " + comboName);
            report.line("");
            report.line(String.format(Locale.ROOT,
                    "- 전체 정답 **%d/%d**, SINGLE %d/%d, MULTIPLE Recall %.2f · 정밀도 %.2f (%d문항), NONE %d/%d",
                    allOk, all, single.ok, single.n, multiple == 0 ? 0 : recallSum / multiple,
                    multiple == 0 ? 0 : precisionSum / multiple, multiple, none.ok, none.n));
            report.line(String.format(Locale.ROOT,
                    "- 틀리게 바로 이동 **%d**, 없는 장면인데 이동 **%d**, 키워드만으로 끝남 %d, 지연 p50 %dms · p95 %dms, LLM 호출 %d(실패 %d, 429 재시도 %d), 크레딧 %s",
                    wrongMove, noneButMoved, keywordSolved, lat.percentile(50), lat.percentile(95), total.calls(),
                    total.errors(), total.retries(), fmt(total.credits())));
            if (vectorSearch != null && mode != SceneSearchProperties.Mode.OFF) {
                long embedTokens = vectorSearch.tokens - embedTokensStart;
                report.line(String.format(Locale.ROOT, "- 임베딩(줄 색인 포함, 처음 한 번) 질문 %d회 · %d토큰 · 크레딧 %s",
                        vectorSearch.queryCalls - embedQueriesStart, embedTokens, fmt(embedTokens * 0.0013)));
            }
            if (!failures.isEmpty()) {
                report.line("");
                report.line("<details><summary>틀린 문항 " + failures.size() + "개 (1회차)</summary>");
                report.line("");
                failures.forEach(f -> report.line("- " + f));
                report.line("</details>");
            }
        }
    }

    private static final SceneVectorSearch NO_VECTOR = new SceneVectorSearch() {
        @Override
        public boolean ready(long descriptionId) {
            return false;
        }

        @Override
        public List<VectorLine> search(long descriptionId, String query, Long chatLogId, int topK) {
            return List.of();
        }
    };

    /**
     * 평가용 벡터 검색: scenes.json의 줄(장면 설명·해설·대사·화면 글자)을 실제 임베딩해 메모리에서 코사인 순.
     * 줄·질문 벡터는 모드·조합 사이에 재사용한다(운영은 PgSceneVectorSearch)
     */
    static final class InMemoryVectorSearch implements SceneVectorSearch {
        private final GmsEmbeddingClient client;
        private final Map<Long, List<SceneSourceLine>> linesOf = new HashMap<>();
        private final Map<Long, List<float[]>> vectorsOf = new HashMap<>();
        private final Map<String, float[]> queries = new HashMap<>();
        long tokens;
        int queryCalls;

        InMemoryVectorSearch(String key, Map<Long, List<SceneText>> scenesOf) {
            AiCallRecorder recorder = new AiCallRecorder(null) {
                @Override
                public Long record(AiCallLog callLog) {
                    tokens += callLog.getInputTokens();
                    return null;
                }
            };
            GmsProperties gms = new GmsProperties(GmsProperties.Mode.REAL, key, null, null, Duration.ofSeconds(2), 0, null,
                    null, null, null, Map.of(), null, null, null);
            this.client = new GmsEmbeddingClient(new EmbeddingProperties(null, null, null, null, Duration.ofSeconds(10),
                    Duration.ofSeconds(60)), gms, JsonMapper.builder().build(), recorder, new SimpleMeterRegistry());
            scenesOf.forEach((descriptionId, scenes) -> linesOf.put(descriptionId, lines(scenes)));
        }

        private static List<SceneSourceLine> lines(List<SceneText> scenes) {
            List<SceneSourceLine> lines = new ArrayList<>();
            for (SceneText scene : scenes) {
                if (scene.sceneDescription() != null && !scene.sceneDescription().isBlank()) {
                    lines.add(new SceneSourceLine("SCENE", 0, scene.startMs(), scene.sceneDescription()));
                }
                for (SceneText.Moment moment : scene.moments()) {
                    if (moment.text() != null && !moment.text().isBlank()) {
                        lines.add(new SceneSourceLine(moment.type().name(), 0, moment.startMs(), moment.text()));
                    }
                }
            }
            return lines;
        }

        @Override
        public boolean ready(long descriptionId) {
            return !linesOf.getOrDefault(descriptionId, List.of()).isEmpty();
        }

        @Override
        public List<VectorLine> search(long descriptionId, String query, Long chatLogId, int topK) {
            List<SceneSourceLine> lines = linesOf.get(descriptionId);
            List<float[]> vectors = vectorsOf.computeIfAbsent(descriptionId,
                    id -> client.embedDocuments(lines.stream().map(SceneSourceLine::text).toList(), null));
            float[] q = queries.computeIfAbsent(query, text -> {
                queryCalls++;
                return client.embedQuery(text, null);
            });
            List<VectorLine> found = new ArrayList<>();
            for (int i = 0; i < lines.size(); i++) {
                SceneSourceLine line = lines.get(i);
                found.add(new VectorLine(line.sourceType(), i, line.startMs(), line.text(), cosine(q, vectors.get(i))));
            }
            found.sort((a, b) -> Double.compare(b.similarity(), a.similarity()));
            return found.subList(0, Math.min(topK, found.size()));
        }

        private static double cosine(float[] a, float[] b) {
            double dot = 0;
            double na = 0;
            double nb = 0;
            for (int i = 0; i < a.length; i++) {
                dot += a[i] * b[i];
                na += a[i] * a[i];
                nb += b[i] * b[i];
            }
            return dot / (Math.sqrt(na) * Math.sqrt(nb));
        }
    }

    private static boolean in(int targetMs, List<Integer> w) {
        return targetMs >= w.get(0) - WINDOW_LEAD_MS && targetMs <= w.get(1);
    }

    private static boolean inAny(int targetMs, List<List<Integer>> windows) {
        return windows.stream().anyMatch(w -> in(targetMs, w));
    }

    private static String windowsText(List<List<Integer>> windows) {
        return windows.stream().map(w -> w.get(0) / 1000 + "~" + w.get(1) / 1000 + "s").toList().toString();
    }

    // ---------------- LLM 호출 기록 ----------------

    private static LlmProvider provider(String model, String key) {
        GmsProperties properties = new GmsProperties(GmsProperties.Mode.REAL, key, GEMINI_URL, ANTHROPIC_URL,
                Duration.ofSeconds(2), 0, Map.of("gemini-3.5-flash-lite", "minimal"),
                new GmsProperties.Models(model, model, model),
                new GmsProperties.Timeouts(Duration.ofSeconds(5), Duration.ofSeconds(10), Duration.ofSeconds(60)),
                Duration.ofSeconds(10), Map.of(), null, null, null);
        ObjectMapper mapper = JsonMapper.builder().build();
        return model.startsWith("claude") ? new ClaudeLlmProvider(properties, mapper) : new GeminiLlmProvider(properties, mapper);
    }

    record Snapshot(int calls, int errors, long inputTokens, long outputTokens, double credits, long sleptMs, int retries) {
        Snapshot minus(Snapshot o) {
            return new Snapshot(calls - o.calls, errors - o.errors, inputTokens - o.inputTokens,
                    outputTokens - o.outputTokens, credits - o.credits, sleptMs - o.sleptMs, retries - o.retries);
        }
    }

    /** 실제 공급사를 부르고 호출 수·토큰·크레딧을 센다. 429는 5·10·20·40·60·60초 쉬고 다시(쉰 시간은 지연에서 뺌, 다시 부른 횟수는 retries) */
    static final class RecordingClient implements LlmClient {
        private final LlmProvider provider;
        private final String model;
        private final long sleepBetweenMs;
        private static final long[] RATE_LIMIT_WAITS_MS = {5_000, 10_000, 20_000, 40_000, 60_000, 60_000};
        private final double[] price;
        private int calls;
        private int errors;
        private long inputTokens;
        private long outputTokens;
        private double credits;
        private long sleptMs;
        private int retries;

        RecordingClient(LlmProvider provider, String model, long sleepBetweenMs) {
            this.provider = provider;
            this.model = model;
            this.sleepBetweenMs = sleepBetweenMs;
            this.price = PRICES.getOrDefault(model, new double[]{0, 0});
        }

        String model() {
            return model;
        }

        Snapshot snapshot() {
            return new Snapshot(calls, errors, inputTokens, outputTokens, credits, sleptMs, retries);
        }

        @Override
        public LlmResult generate(LlmRequest request) {
            sleep(sleepBetweenMs);
            calls++;
            for (int attempt = 0; ; attempt++) {
                try {
                    LlmResult r = provider.generate(request, model);
                    inputTokens += r.inputTokens();
                    outputTokens += r.outputTokens();
                    credits += r.inputTokens() * price[0] + r.outputTokens() * price[1];
                    return r;
                } catch (LlmException e) {
                    if (e.getKind() == LlmException.Kind.RATE_LIMIT && attempt < RATE_LIMIT_WAITS_MS.length) {
                        retries++;
                        sleep(RATE_LIMIT_WAITS_MS[attempt]);
                        continue;
                    }
                    errors++;
                    throw e;
                }
            }
        }

        @Override
        public LlmResult stream(LlmRequest request, DeltaHandler handler) {
            throw new UnsupportedOperationException("답변은 HTTP 러너로 잰다");
        }

        private void sleep(long ms) {
            if (ms <= 0) {
                return;
            }
            sleptMs += ms;
            try {
                Thread.sleep(ms);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    // ---------------- 집계·출력 ----------------

    static final class Stats {
        int n;
        int ok;
        int rule;
        final List<Long> latencies = new ArrayList<>();

        void add(boolean correct, long ms, boolean byRule) {
            n++;
            ok += correct ? 1 : 0;
            rule += byRule ? 1 : 0;
            latencies.add(ms);
        }

        double accuracy() {
            return n == 0 ? 0 : ok * 100.0 / n;
        }

        double ruleShare() {
            return n == 0 ? 0 : rule * 100.0 / n;
        }

        long percentile(int p) {
            if (latencies.isEmpty()) {
                return 0;
            }
            List<Long> sorted = latencies.stream().sorted().toList();
            int index = (int) Math.ceil(p / 100.0 * sorted.size()) - 1;
            return sorted.get(Math.max(0, Math.min(index, sorted.size() - 1)));
        }
    }

    static final class Report {
        private final StringBuilder md = new StringBuilder();
        final List<List<String>> intentRows = new ArrayList<>(List.of(List.of("model", "combo", "run", "id", "utterance",
                "expected", "got", "result", "source", "ms", "llmCalls", "credits", "tags")));
        final List<List<String>> seekRows = new ArrayList<>(List.of(List.of("model", "combo", "run", "id", "videoId", "query",
                "kind", "windows", "got", "source", "result", "wrongMove", "ms", "llmCalls", "credits", "tags")));

        void line(String s) {
            md.append(s).append('\n');
        }

        String summary() {
            return md.toString();
        }

        String csv(List<List<String>> rows) {
            StringBuilder sb = new StringBuilder("﻿");
            for (List<String> row : rows) {
                sb.append(String.join(",", row.stream().map(Report::cell).toList())).append('\n');
            }
            return sb.toString();
        }

        private static String cell(String v) {
            String s = v == null ? "" : v;
            return s.contains(",") || s.contains("\"") || s.contains("\n") ? "\"" + s.replace("\"", "\"\"") + "\"" : s;
        }
    }

    /** 실행 중 진행 상황을 build/eval/progress.txt에 덮어쓴다 */
    private static void progress(RecordingClient client, String part, int done, int total) {
        Snapshot now = client.snapshot();
        String line = String.format(Locale.ROOT, "%s %s %s %d/%d (LLM %d, 429 재시도 %d)%n",
                LocalDateTime.now().withNano(0), client.model(), part, done, total, now.calls(), now.retries());
        try {
            Files.writeString(Path.of("build/eval/progress.txt"), line, StandardCharsets.UTF_8);
        } catch (IOException ignored) {
            // 진행 표시는 실패해도 평가는 계속
        }
    }

    private static String fmt(double credits) {
        return String.format(Locale.ROOT, "%.2f", credits);
    }

    private static String env(String name, String fallback) {
        String v = System.getenv(name);
        return v == null || v.isBlank() ? fallback : v;
    }

    private static String apiKey() throws IOException {
        return envOrDotEnv("GMS_API_KEY");
    }

    private static String envOrDotEnv(String name) throws IOException {
        String value = System.getenv(name);
        if (value != null && !value.isBlank()) {
            return value.strip();
        }
        for (Path p : List.of(Path.of(".env"), Path.of("../.env"))) {
            if (Files.exists(p)) {
                for (String line : Files.readAllLines(p)) {
                    String s = line.strip();
                    if (s.startsWith(name + "=")) {
                        return s.substring(name.length() + 1).strip();
                    }
                }
            }
        }
        throw new IllegalStateException(name + "가 없습니다(환경 변수 또는 레포 루트 .env)");
    }

    /** H200 평가 서버 /generate(크레딧 0, 토큰 수 없음). 실패는 UNAVAILABLE·TIMEOUT으로 */
    static final class H200Provider implements LlmProvider {
        private final HttpClient http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofSeconds(3)).build();
        private final String url;
        private final String token;
        private final ObjectMapper om;

        H200Provider(String url, String token, ObjectMapper om) {
            this.url = url;
            this.token = token;
            this.om = om;
        }

        @Override
        public LlmResult generate(LlmRequest request, String model) {
            long t0 = System.nanoTime();
            try {
                String body = om.writeValueAsString(Map.of("system", request.system(), "user", request.user(),
                        "maxTokens", request.maxOutputTokens()));
                HttpRequest req = HttpRequest.newBuilder(URI.create(url + "/generate"))
                        .timeout(Duration.ofSeconds(60))
                        .header("Content-Type", "application/json")
                        .header("Authorization", "token " + token)
                        .POST(HttpRequest.BodyPublishers.ofString(body)).build();
                HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
                if (res.statusCode() != 200) {
                    throw new LlmException(LlmException.Kind.UNAVAILABLE, res.statusCode(), res.body(), null);
                }
                Map<?, ?> json = om.readValue(res.body(), Map.class);
                return new LlmResult(String.valueOf(json.get("text")), "h200:qwen3-vl-8b", 0, 0,
                        (System.nanoTime() - t0) / 1_000_000, false, null);
            } catch (java.net.http.HttpTimeoutException e) {
                throw new LlmException(LlmException.Kind.TIMEOUT, 0, e.getMessage(), e);
            } catch (IOException e) {
                throw new LlmException(LlmException.Kind.UNAVAILABLE, 0, e.getMessage(), e);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new LlmException(LlmException.Kind.UNAVAILABLE, 0, "interrupted", e);
            }
        }

        @Override
        public LlmResult stream(LlmRequest request, String model, DeltaHandler handler) {
            throw new UnsupportedOperationException("H200은 분류·장면 찾기만 잰다");
        }
    }

    // ---------------- 평가셋 모양 ----------------

    @JsonIgnoreProperties(ignoreUnknown = true)
    record EvalSet(String version, List<IntentCase> intent, List<SeekCase> seek, List<VideoData> extraVideos) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record IntentCase(String id, String utterance, Map<String, Object> expected, List<String> alsoAccept, List<String> tags) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record SeekCase(String id, long videoId, int nowMs, String query, String kind, List<List<Integer>> windows,
                    boolean allowNone, List<String> tags) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record VideoData(long videoId, Long descriptionId, String title, List<SceneText> scenes) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record ScenesFile(List<VideoData> videos) {
    }
}
