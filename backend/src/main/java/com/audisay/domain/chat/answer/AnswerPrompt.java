package com.audisay.domain.chat.answer;

import com.audisay.domain.chat.search.ChapterTitle;
import com.audisay.domain.chat.search.VectorLine;
import com.audisay.domain.description.service.AnswerContext;
import com.audisay.domain.description.service.AnswerContext.Dialogue;
import com.audisay.domain.description.service.AnswerContext.SceneInfo;
import com.audisay.domain.description.service.FutureContext;
import com.audisay.domain.description.service.RecapContext;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 답변 프롬프트. QUESTION은 모델 비교 스파이크 ANSWER_SYSTEM 그대로(저장 자료만으로 평가 문항 정답),
 * SCENE_NOW는 장면 제목을 먼저 읽어 준 뒤({@link SceneNowComposer}) 지금 화면을 1~2문장으로. 자료 키는 그대로 프롬프트에 들어가므로 한국어
 */
@Component
@RequiredArgsConstructor
public class AnswerPrompt {
    static final int MAX_OUTPUT_TOKENS = 300;
    public static final String UNANSWERABLE = "그건 해설 자료에 없어요.";
    /**
     * "골 장면이 몇 개야?"처럼 수를 물으면 영상 전체 수를 몰라 '자료에 없어요' → '이후에 나와요'로 가던 것을,
     * 질문한 시각까지 나온 것만 세어 답하게 한다(하나도 없을 때만 뒤 확인으로)
     */
    static final String COUNT_RULE = "몇 개·몇 번·몇 골처럼 수를 물으면 자료에 나온 것만 세어 '지금까지는 ~예요'처럼 답하세요. "
            + "자료에 하나도 없을 때만 '그건 해설 자료에 없어요.'라고 답하세요. ";
    /**
     * "지금 스코어 어떻게 돼?"에 "1-1 동점이던 8회초"가 자료에 있는데도 뒤에 바뀌었을까 봐 '자료에 없어요'로 가던 것을,
     * 가장 최근에 나온 상태로 답하게 한다
     */
    static final String STATE_RULE = "지금 점수·상황·누가 앞서는지처럼 지금 상태를 물으면 자료에 가장 최근에 나온 상태로 "
            + "'지금은 ~예요'처럼 답하세요. 그 뒤에 바뀌었다는 내용이 자료에 없으면 그 상태 그대로입니다. ";
    /** 묻는 것(방법·수·이름·때)이 자료에 없는데 같은 주제의 다른 내용으로 대신 답하던 것을 막는다(그래야 뒤 확인으로 간다) */
    static final String SAME_ASK_RULE = "주제가 같아도 묻는 것과 다른 내용(예: 몇 분 끓이는지 물었는데 재료 양)으로 대신 답하지 말고 "
            + "'그건 해설 자료에 없어요.'라고 답하세요. ";
    static final String QUESTION_SYSTEM = "당신은 시각장애인이 영상을 보다가 한 질문에 답하는 도우미입니다. "
            + "아래 '해설 자료'(현재 시각 근처의 장면·대사)만 근거로 한국어로 1~2문장, 짧게 말하듯 답하세요. "
            + "자료에 답이 없으면 지어내거나 설명을 붙이지 말고 '그건 해설 자료에 없어요.' 한 문장만 답하세요. "
            + SAME_ASK_RULE + COUNT_RULE + STATE_RULE
            + "사람이나 캐릭터 이름은 자료에 이름이 있을 때만 말하세요. 시각 숫자나 MM:SS는 읽지 마세요.";
    static final String QUESTION_EARLIER_SYSTEM = "당신은 시각장애인이 영상을 보다가 한 질문에 답하는 도우미입니다. "
            + "아래 '해설 자료'(현재 시각 근처의 장면·대사)와 '앞에서 나온 관련 내용'(질문한 시각 전에 나온 줄 중 질문과 비슷한 줄)만 "
            + "근거로 한국어로 1~2문장, 짧게 말하듯 답하세요. "
            + "자료에 답이 없으면 지어내거나 설명을 붙이지 말고 '그건 해설 자료에 없어요.' 한 문장만 답하세요. "
            + "어떤 일이 일어나는지 묻는데 자료에 그 일이 없으면 '아니요'로 짐작하지 말고 '그건 해설 자료에 없어요.'라고 답하세요. "
            + "'지금까지 장면 순서'는 질문한 시각 전에 끝난 장면 제목입니다. 몇 회·몇 번째·언제처럼 때나 순서를 물으면 "
            + "앞에서 나온 줄의 시각을 이 장면 순서에 맞춰 답하세요. "
            + SAME_ASK_RULE + COUNT_RULE + STATE_RULE
            + "사람이나 캐릭터 이름은 자료에 이름이 있을 때만 말하세요. 시각 숫자나 MM:SS는 읽지 마세요.";
    static final String SCENE_NOW_SYSTEM = "당신은 시각장애인에게 지금 영상 화면을 설명하는 도우미입니다. "
            + "아래 '해설 자료'만 근거로 지금 화면에 무엇이 보이고 무슨 일이 일어나는지 한국어로 1~2문장, 짧게 말하듯 설명하세요. "
            + "장면 제목은 이미 읽어 주었으니 다시 말하지 마세요. 지금 장면의 해설 문장 중 시각이 '현재 시각'에 가까운 것과 화면 글자를 먼저 쓰세요. "
            + "자료에 없는 내용은 지어내지 마세요. 사람 이름은 자료에 있을 때만, 시각 숫자나 MM:SS는 읽지 마세요.";
    /** answer-past-only: 장면 제목(뒤 내용이 담길 수 있음)을 읽지 않고 질문한 시각까지 자료로만 */
    static final String SCENE_NOW_PAST_SYSTEM = "당신은 시각장애인에게 지금 영상 화면을 설명하는 도우미입니다. "
            + "아래 '해설 자료'만 근거로 지금 화면에 무엇이 보이고 무슨 일이 일어나는지 한국어로 1~2문장, 짧게 말하듯 설명하세요. "
            + "지금 장면의 해설 문장 중 시각이 '현재 시각'에 가까운 것과 화면 글자를 먼저 쓰세요. "
            + "자료에 없는 내용은 지어내지 마세요. 사람 이름은 자료에 있을 때만, 시각 숫자나 MM:SS는 읽지 마세요.";
    static final String SCENE_NOW_REQUEST = "지금 화면을 설명해 주세요.";
    static final int FUTURE_MAX_CHARS = 12_000;
    static final int CHECK_MAX_OUTPUT_TOKENS = 300;
    public static final String FUTURE_PROMPT = "그건 지금 시점 이후에 나와요. 그래도 들으시겠어요?";
    public static final String NO_RECAP = "아직 지난 내용이 없어요.";
    static final String RECAP_SYSTEM = "당신은 시각장애인에게 영상의 지금까지 줄거리를 알려 주는 도우미입니다. "
            + "아래 '지금까지 내용'만 근거로 일어난 순서대로, 요청한 문장 수 안에서 한국어로 짧게 말하듯 정리하세요. "
            + "장면이 많아도 중간 단계를 건너뛰지 말고 장면마다 한 구절씩 이어 말하세요. "
            + "지금 시각 뒤에 일어날 일은 자료에 없으니 짐작하지 마세요. 자료에 없는 이유·관계·누가 했는지도 덧붙이지 마세요. "
            + "사람이나 캐릭터 이름은 자료에 이름이 있을 때만 말하세요. 시각 숫자나 MM:SS는 읽지 마세요.";
    /** 지난 장면 3개마다 1문장씩 늘린다(2~5문장). 고정 2~4문장이면 긴 영상 뒤쪽에서 중간 단계가 빠졌다(RECAP 평가) */
    static final int RECAP_MIN_SENTENCES = 2;
    static final int RECAP_MAX_SENTENCES = 5;
    static final int RECAP_MAX_OUTPUT_TOKENS = 500;
    static final String FUTURE_CHECK_SYSTEM = "시각장애인이 영상을 보다가 한 질문입니다. 아래 '뒤 내용'(질문한 시각 이후의 장면·해설 문장·대사·화면 글자와 "
            + "영상 전체 요약)에서 질문에 대한 답이 되는 부분을 찾아 40자 이내 한 구절로 옮기세요. 영상 요약에 답이 있어도 됩니다. "
            + "답이 없거나 비슷한 내용뿐이면 빈 문자열로 두세요. "
            + "설명 없이 JSON 한 줄만 답하세요: {\"evidence\": \"답이 되는 문장\"} 또는 {\"evidence\": \"\"}";
    static final String FUTURE_CHECK_LINES_SYSTEM = "시각장애인이 영상을 보다가 한 질문입니다. 아래 '뒤 내용'(질문한 시각 이후에 나온 "
            + "장면 설명·해설 문장·대사·화면 글자 중 질문과 비슷한 줄)에서 질문에 대한 답이 되는 줄을 찾아 40자 이내 한 구절로 옮기세요. "
            + "영상 요약에 답이 있어도 됩니다. "
            + "답이 없거나 비슷한 내용뿐이면 빈 문자열로 두세요. "
            + "설명 없이 JSON 한 줄만 답하세요: {\"evidence\": \"답이 되는 문장\"} 또는 {\"evidence\": \"\"}";
    static final String FUTURE_SYSTEM = "당신은 시각장애인이 영상을 보다가 한 질문에 답하는 도우미입니다. "
            + "사용자가 질문한 시각 이후 내용도 듣기로 했습니다. 아래 '해설 자료'(질문한 시각까지)와 '뒤 내용'(이후)만 근거로 "
            + "한국어로 1~2문장, 짧게 말하듯 답하세요. 자료에 없는 내용은 지어내지 말고 '그건 해설 자료에 없어요'라고 답하세요. "
            + "사람이나 캐릭터 이름은 자료에 이름이 있을 때만 말하세요. 시각 숫자나 MM:SS는 읽지 마세요.";

    /** haiku(대체 모델)는 문구를 바꿔 말할 수 있어 한 문구로만 보지 않는다(스파이크 채점과 같은 기준) */
    private static final Pattern SAID_NO = Pattern.compile(
            "(자료|해설)(?![^.?!]{0,6}(따르면|보면|의하면))[^.?!]{0,60}?(없|나오지 않|나와 있지 않|있지 않|알 수 없)");

    /** 닫는 따옴표·중괄호 없이 잘린 {"evidence": "... */
    private static final Pattern TRUNCATED_EVIDENCE = Pattern.compile("\"evidence\"\\s*:\\s*\"([^\"]+)$");

    private final ObjectMapper objectMapper;

    public String questionUser(AnswerContext context, String question) {
        return "해설 자료:\n" + json(context) + "\n\n질문: " + question;
    }

    /** 바로 하는 답 + 앞에서 나온 관련 내용(질문 답변 RAG). 앞 줄이 없으면 questionUser와 같다 */
    public String questionUser(AnswerContext context, List<VectorLine> earlier, String question) {
        return questionUser(context, earlier, List.of(), question);
    }

    /** 앞 줄이 있으면 끝난 장면 제목(시간순)도 함께. 앞 줄이 없으면 questionUser와 같다 */
    public String questionUser(AnswerContext context, List<VectorLine> earlier, List<ChapterTitle> titles, String question) {
        if (earlier.isEmpty()) {
            return questionUser(context, question);
        }
        String order = titles.isEmpty() ? "" : "\n\n지금까지 장면 순서:\n" + objectMapper.writeValueAsString(titles.stream().map(t -> {
            Map<String, Object> map = new LinkedHashMap<>();
            map.put("시작", clock(t.startMs()));
            map.put("제목", t.title());
            return map;
        }).toList());
        return "해설 자료:\n" + json(context) + order + "\n\n앞에서 나온 관련 내용:\n"
                + objectMapper.writeValueAsString(lineMaps(earlier)) + "\n\n질문: " + question;
    }

    /** 뒤 확인(질문 답변 RAG): 뒤 내용 전체 대신 질문과 비슷한 뒤 줄 + 영상 요약 */
    public String futureCheckLinesUser(String summary, List<VectorLine> later, String question) {
        Map<String, Object> map = new LinkedHashMap<>();
        if (summary != null && !summary.isBlank()) {
            map.put("영상 요약", summary);
        }
        map.put("뒤 줄", lineMaps(later));
        return "뒤 내용:\n" + objectMapper.writeValueAsString(map) + "\n\n질문: " + question;
    }

    private static List<Map<String, Object>> lineMaps(List<VectorLine> lines) {
        return lines.stream().map(line -> {
            Map<String, Object> map = new LinkedHashMap<>();
            map.put("시각", clock(line.startMs()));
            map.put("종류", switch (line.sourceType()) {
                case "SCENE" -> "장면 설명";
                case "NARRATION" -> "해설";
                case "DIALOGUE" -> "대사";
                default -> "화면 글자";
            });
            map.put("글", line.text());
            return map;
        }).toList();
    }

    public String futureCheckUser(FutureContext future, String question) {
        return "뒤 내용:\n" + futureJson(future) + "\n\n질문: " + question;
    }

    public String futureUser(AnswerContext context, FutureContext future, String question) {
        return "해설 자료:\n" + json(context) + "\n\n뒤 내용:\n" + futureJson(future) + "\n\n질문: " + question;
    }

    /**
     * {"evidence": "..."}에서 뒤 내용의 답 문장. 비었거나 읽을 수 없으면 null(뒤에 답이 없는 것으로).
     * 근거를 길게 옮기다 출력 한도로 잘린 응답({"evidence": "...)도 글자가 있으면 답이 있는 것으로 본다
     */
    public String evidence(String text) {
        if (text == null) {
            return null;
        }
        int start = text.indexOf('{');
        int end = text.lastIndexOf('}');
        if (start >= 0 && end > start) {
            try {
                Object value = objectMapper.readValue(text.substring(start, end + 1), Map.class).get("evidence");
                return value instanceof String s && !s.isBlank() ? s.strip() : null;
            } catch (JacksonException e) {
                // 아래에서 잘린 응답으로 다시 본다
            }
        }
        Matcher truncated = TRUNCATED_EVIDENCE.matcher(text);
        return truncated.find() && !truncated.group(1).isBlank() ? truncated.group(1).strip() : null;
    }

    public String recapUser(RecapContext recap) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("영상 제목", recap.videoTitle());
        map.put("현재 시각", clock(recap.nowMs()));
        map.put("지금까지 장면", recap.parts().stream().map(p -> {
            Map<String, Object> part = new LinkedHashMap<>();
            part.put("시작", clock(p.startMs()));
            if (p.title() != null) {
                part.put("제목", p.title());
            }
            if (p.text() != null) {
                part.put("내용", p.text());
            }
            return part;
        }).toList());
        return "지금까지 내용:\n" + objectMapper.writeValueAsString(map) + "\n\n요청: 지금까지 줄거리를 "
                + recapSentences(recap.parts().size()) + "문장 이내로 정리해 주세요.";
    }

    static int recapSentences(int parts) {
        return Math.min(RECAP_MAX_SENTENCES, Math.max(RECAP_MIN_SENTENCES, RECAP_MIN_SENTENCES + parts / 3));
    }

    public String sceneNowUser(AnswerContext context) {
        return "해설 자료:\n" + json(context) + "\n\n요청: " + SCENE_NOW_REQUEST;
    }

    /** SCENE_NOW 첫 문장(AI 없이 바로 읽음) */
    public static String sceneTitleSentence(SceneInfo scene) {
        return "지금은 " + scene.title() + " 장면이에요.";
    }

    public static boolean saidUnanswerable(String answer) {
        return answer != null && SAID_NO.matcher(answer).find();
    }

    String json(AnswerContext context) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("현재 시각", clock(context.nowMs()));
        map.put("영상 제목", context.videoTitle());
        if (context.summary() != null) {
            map.put("영상 요약", context.summary());
        }
        map.put("장면(앞 장면, 지금 장면)", context.scenes().stream().map(AnswerPrompt::sceneMap).toList());
        map.put("최근 60초 대사", context.recentDialogues().stream().map(AnswerPrompt::dialogueMap).toList());
        map.put("등장인물", context.characters().stream().map(c -> {
            Map<String, Object> person = new LinkedHashMap<>();
            person.put("이름", c.name());
            person.put("겉모습", c.appearance());
            return person;
        }).toList());
        return objectMapper.writeValueAsString(map);
    }

    /**
     * 뒤 내용 JSON. 1.2만 자를 넘으면 시각이 늦은 장면·대사부터 뺀다.
     * 긴 영상은 항목이 수천 개라 하나씩 빼며 매번 전체를 다시 만들지 않고, 이른 것부터 항목 길이를 더해 한 번에 자른다
     */
    String futureJson(FutureContext future) {
        List<SceneInfo> scenes = new ArrayList<>();
        List<Dialogue> dialogues = new ArrayList<>();
        int length = futureJsonOf(future.summary(), List.of(), List.of()).length();
        int si = 0;
        int di = 0;
        List<SceneInfo> allScenes = future.scenes();
        List<Dialogue> allDialogues = future.dialogues();
        while (si < allScenes.size() || di < allDialogues.size()) {
            // 뺄 때와 같은 순서: 같은 시각이면 장면을 먼저 남긴다
            boolean takeScene = di >= allDialogues.size() || (si < allScenes.size()
                    && allScenes.get(si).startMs() <= allDialogues.get(di).startMs());
            String item = takeScene ? objectMapper.writeValueAsString(sceneMap(allScenes.get(si)))
                    : objectMapper.writeValueAsString(dialogueMap(allDialogues.get(di)));
            length += item.length() + 1;
            if (length > FUTURE_MAX_CHARS) {
                break;
            }
            if (takeScene) {
                scenes.add(allScenes.get(si++));
            } else {
                dialogues.add(allDialogues.get(di++));
            }
        }
        String json = futureJsonOf(future.summary(), scenes, dialogues);
        // 길이 어림이 어긋났을 때만(거의 없음) 늦은 것부터 하나씩 뺀다
        while (json.length() > FUTURE_MAX_CHARS && (!scenes.isEmpty() || !dialogues.isEmpty())) {
            boolean dropDialogue = scenes.isEmpty() || (!dialogues.isEmpty()
                    && dialogues.get(dialogues.size() - 1).startMs() >= scenes.get(scenes.size() - 1).startMs());
            if (dropDialogue) {
                dialogues.remove(dialogues.size() - 1);
            } else {
                scenes.remove(scenes.size() - 1);
            }
            json = futureJsonOf(future.summary(), scenes, dialogues);
        }
        return json;
    }

    private String futureJsonOf(String summary, List<SceneInfo> scenes, List<Dialogue> dialogues) {
        Map<String, Object> map = new LinkedHashMap<>();
        if (summary != null) {
            map.put("영상 요약", summary);
        }
        map.put("뒤 장면", scenes.stream().map(AnswerPrompt::sceneMap).toList());
        map.put("뒤 대사", dialogues.stream().map(AnswerPrompt::dialogueMap).toList());
        return objectMapper.writeValueAsString(map);
    }

    private static Map<String, Object> sceneMap(SceneInfo s) {
        Map<String, Object> scene = new LinkedHashMap<>();
        scene.put("시작", clock(s.startMs()));
        if (s.title() != null) {
            scene.put("제목", s.title());
        }
        if (s.description() != null) {
            scene.put("장면 설명", s.description());
        }
        scene.put("해설 문장", s.narrations().stream().map(n -> {
            Map<String, Object> narration = new LinkedHashMap<>();
            narration.put("시각", clock(n.startMs()));
            narration.put("문장", n.text());
            return narration;
        }).toList());
        scene.put("화면 글자", s.screenTexts());
        return scene;
    }

    private static Map<String, Object> dialogueMap(Dialogue d) {
        Map<String, Object> dialogue = new LinkedHashMap<>();
        dialogue.put("시각", clock(d.startMs()));
        dialogue.put("말한 사람", d.speaker());
        dialogue.put("대사", d.text());
        return dialogue;
    }

    static String clock(int ms) {
        int total = ms / 1000;
        int h = total / 3600;
        int m = total % 3600 / 60;
        int s = total % 60;
        return h > 0 ? String.format("%d:%02d:%02d", h, m, s) : String.format("%02d:%02d", m, s);
    }

    /** 장면 설명을 문장으로(SCENE_NOW에서 LLM을 못 쓸 때) */
    public static List<String> sentencesOf(String text, int max) {
        SentenceSplitter splitter = new SentenceSplitter();
        List<String> out = new ArrayList<>(splitter.add(text == null ? "" : text));
        splitter.flush().ifPresent(out::add);
        return out.size() <= max ? out : out.subList(0, max);
    }
}
