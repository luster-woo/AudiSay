package com.audisay.domain.chat.answer;

import com.audisay.domain.description.service.AnswerContext;
import com.audisay.domain.description.service.AnswerContext.SceneInfo;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
    static final String QUESTION_SYSTEM = "당신은 시각장애인이 영상을 보다가 한 질문에 답하는 도우미입니다. "
            + "아래 '해설 자료'(현재 시각 근처의 장면·대사)만 근거로 한국어로 1~2문장, 짧게 말하듯 답하세요. "
            + "자료에 없는 내용은 지어내지 말고 '그건 해설 자료에 없어요'라고 답하세요. "
            + "사람이나 캐릭터 이름은 자료에 이름이 있을 때만 말하세요. 시각 숫자나 MM:SS는 읽지 마세요.";
    static final String SCENE_NOW_SYSTEM = "당신은 시각장애인에게 지금 영상 화면을 설명하는 도우미입니다. "
            + "아래 '해설 자료'만 근거로 지금 화면에 무엇이 보이고 무슨 일이 일어나는지 한국어로 1~2문장, 짧게 말하듯 설명하세요. "
            + "장면 제목은 이미 읽어 주었으니 다시 말하지 마세요. 지금 장면의 해설 문장 중 시각이 '현재 시각'에 가까운 것과 화면 글자를 먼저 쓰세요. "
            + "자료에 없는 내용은 지어내지 마세요. 사람 이름은 자료에 있을 때만, 시각 숫자나 MM:SS는 읽지 마세요.";
    static final String SCENE_NOW_REQUEST = "지금 화면을 설명해 주세요.";

    /** haiku(대체 모델)는 문구를 바꿔 말할 수 있어 한 문구로만 보지 않는다(스파이크 채점과 같은 기준) */
    private static final Pattern SAID_NO = Pattern.compile(
            "(자료|해설)[^.?!]{0,20}(없|나오지 않|나와 있지 않|있지 않|알 수 없)");

    private final ObjectMapper objectMapper;

    public String questionUser(AnswerContext context, String question) {
        return "해설 자료:\n" + json(context) + "\n\n질문: " + question;
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
        map.put("영상 요약", context.summary());
        map.put("장면(앞 장면, 지금 장면)", context.scenes().stream().map(s -> {
            Map<String, Object> scene = new LinkedHashMap<>();
            scene.put("시작", clock(s.startMs()));
            scene.put("제목", s.title());
            scene.put("장면 설명", s.description());
            scene.put("해설 문장", s.narrations().stream().map(n -> {
                Map<String, Object> narration = new LinkedHashMap<>();
                narration.put("시각", clock(n.startMs()));
                narration.put("문장", n.text());
                return narration;
            }).toList());
            scene.put("화면 글자", s.screenTexts());
            return scene;
        }).toList());
        map.put("최근 60초 대사", context.recentDialogues().stream().map(d -> {
            Map<String, Object> dialogue = new LinkedHashMap<>();
            dialogue.put("시각", clock(d.startMs()));
            dialogue.put("말한 사람", d.speaker());
            dialogue.put("대사", d.text());
            return dialogue;
        }).toList());
        map.put("등장인물", context.characters().stream().map(c -> {
            Map<String, Object> person = new LinkedHashMap<>();
            person.put("이름", c.name());
            person.put("겉모습", c.appearance());
            return person;
        }).toList());
        return objectMapper.writeValueAsString(map);
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
