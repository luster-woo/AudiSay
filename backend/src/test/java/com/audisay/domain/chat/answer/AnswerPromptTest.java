package com.audisay.domain.chat.answer;

import com.audisay.domain.chat.search.ChapterTitle;
import com.audisay.domain.chat.search.VectorLine;
import com.audisay.domain.description.service.AnswerContext;
import com.audisay.domain.description.service.AnswerContext.Dialogue;
import com.audisay.domain.description.service.AnswerContext.Narration;
import com.audisay.domain.description.service.AnswerContext.Person;
import com.audisay.domain.description.service.AnswerContext.SceneInfo;
import com.audisay.domain.description.service.FutureContext;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class AnswerPromptTest {
    private final AnswerPrompt prompt = new AnswerPrompt(JsonMapper.builder().build());

    @Test
    void 줄거리_문장_수는_지난_장면_3개마다_늘고_2에서_5문장() {
        assertThat(List.of(0, 1, 3, 5, 6, 9, 11, 30)).extracting(AnswerPrompt::recapSentences)
                .containsExactly(2, 2, 3, 3, 4, 5, 5, 5);
    }

    private final AnswerContext context = new AnswerContext("테슬라 신형 로드스터 공개 행사", "로드스터를 공개했어요.", 280_000,
            List.of(new SceneInfo(237_000, "무대 위로 등장한 로드스터", "문이 위로 열립니다.",
                            List.of(new Narration(240_000, "차가 무대에 섭니다")),
                            List.of("일론 머스크 스페이스X 최고경영자")),
                    new SceneInfo(261_000, "제로백 가속 테스트", "차가 번개처럼 튀어나갑니다.",
                            List.of(new Narration(270_000, "시속 60마일까지 0.81초")),
                            List.of())),
            List.of(new Dialogue(264_000, null, "This goes fast. (정말 빠릅니다.)")),
            List.of(new Person("일론 머스크", "무대 중앙의 중년 남성")));

    @Test
    void 질문_프롬프트는_스파이크와_같은_모양의_자료와_질문() {
        String user = prompt.questionUser(context, "몇 초 걸렸어?");

        assertThat(user).startsWith("해설 자료:\n{\"현재 시각\":\"04:40\",\"영상 제목\":\"테슬라 신형 로드스터 공개 행사\"")
                .contains("\"장면(앞 장면, 지금 장면)\":[{\"시작\":\"03:57\",\"제목\":\"무대 위로 등장한 로드스터\"")
                .contains("\"해설 문장\":[{\"시각\":\"04:30\",\"문장\":\"시속 60마일까지 0.81초\"}]")
                .contains("\"최근 60초 대사\":[{\"시각\":\"04:24\",\"말한 사람\":null,\"대사\":\"This goes fast. (정말 빠릅니다.)\"}]")
                .contains("\"등장인물\":[{\"이름\":\"일론 머스크\"")
                .endsWith("\n\n질문: 몇 초 걸렸어?");
    }

    @Test
    void 앞_줄이_있으면_끝난_장면_제목을_시간순으로_앞_줄보다_먼저_넣는다() {
        List<VectorLine> earlier = List.of(new VectorLine("NARRATION", 1L, 148_000, "디아즈가 타구를 놓치는 실책을 범한다.", 0.8));
        String user = prompt.questionUser(context, earlier,
                List.of(new ChapterTitle(118_000, "10회 초 디아즈 적시타"), new ChapterTitle(136_000, "10회 말 수비 미스")), "실책 몇 회야?");

        assertThat(user).contains("\n\n지금까지 장면 순서:\n[{\"시작\":\"01:58\",\"제목\":\"10회 초 디아즈 적시타\"},"
                        + "{\"시작\":\"02:16\",\"제목\":\"10회 말 수비 미스\"}]\n\n앞에서 나온 관련 내용:\n")
                .endsWith("\n\n질문: 실책 몇 회야?");
        assertThat(prompt.questionUser(context, earlier, List.of(), "질문")).doesNotContain("장면 순서");
        assertThat(prompt.questionUser(context, List.of(), List.of(new ChapterTitle(0, "오프닝")), "질문"))
                .isEqualTo(prompt.questionUser(context, "질문"));
    }

    @Test
    void 질문_규칙에_지금_상태와_묻는_것만_답하는_규칙이_있다() {
        assertThat(List.of(AnswerPrompt.QUESTION_SYSTEM, AnswerPrompt.QUESTION_EARLIER_SYSTEM))
                .allSatisfy(system -> assertThat(system).contains(AnswerPrompt.STATE_RULE, AnswerPrompt.SAME_ASK_RULE,
                        AnswerPrompt.COUNT_RULE));
        assertThat(AnswerPrompt.QUESTION_EARLIER_SYSTEM).contains("지금까지 장면 순서");
    }

    @Test
    void 요약이_없으면_요약_칸을_넣지_않는다() {
        AnswerContext past = new AnswerContext("제목", null, 1_000, List.of(new SceneInfo(0, "시작", null, List.of(), List.of())),
                List.of(), List.of());

        assertThat(prompt.questionUser(past, "질문")).doesNotContain("영상 요약").doesNotContain("장면 설명");
    }

    @Test
    void 뒤_내용은_1만2천_자를_넘으면_늦은_장면부터_뺀다() {
        List<SceneInfo> scenes = new java.util.ArrayList<>();
        for (int i = 0; i < 100; i++) {
            scenes.add(new SceneInfo(i * 10_000, "장면 " + i, "가".repeat(300), List.of(), List.of()));
        }
        String json = prompt.futureJson(new FutureContext("요약", scenes, List.of()));

        assertThat(json.length()).isLessThanOrEqualTo(AnswerPrompt.FUTURE_MAX_CHARS);
        assertThat(json).contains("장면 0").doesNotContain("장면 99");
    }

    @Test
    void 뒤_내용이_많아도_이른_장면과_대사를_시각_순서대로_남긴다() {
        List<SceneInfo> scenes = new java.util.ArrayList<>();
        List<Dialogue> dialogues = new java.util.ArrayList<>();
        for (int i = 0; i < 3000; i++) {
            scenes.add(new SceneInfo(i * 10_000, "장면 " + i, "가".repeat(50), List.of(), List.of()));
            dialogues.add(new Dialogue(i * 10_000 + 5_000, null, "대사 " + i));
        }
        String json = prompt.futureJson(new FutureContext("요약", scenes, dialogues));

        assertThat(json.length()).isLessThanOrEqualTo(AnswerPrompt.FUTURE_MAX_CHARS)
                .isGreaterThan(AnswerPrompt.FUTURE_MAX_CHARS - 300);
        java.util.regex.Matcher matcher = java.util.regex.Pattern.compile("\"제목\":\"장면 (\\d+)\"").matcher(json);
        int lastScene = -1;
        while (matcher.find()) {
            lastScene = Integer.parseInt(matcher.group(1));
        }
        assertThat(lastScene).isPositive();
        // 시각 순서로 잘렸으면 남은 마지막 장면 앞의 대사는 있고, 그 다음 장면 뒤의 대사는 없다
        assertThat(json).contains("\"대사 " + (lastScene - 1) + "\"")
                .doesNotContain("\"대사 " + (lastScene + 1) + "\"");
    }

    @Test
    void 뒤_내용에서_찾은_답_문장을_읽는다() {
        assertThat(prompt.evidence("{\"evidence\": \" 시속 60마일까지 0.81초 \"}")).isEqualTo("시속 60마일까지 0.81초");
        assertThat(prompt.evidence("```json\n{\"evidence\":\"\"}\n```")).isNull();
        assertThat(prompt.evidence("{\"evidence\": null}")).isNull();
        assertThat(prompt.evidence("모르겠어요")).isNull();
        assertThat(prompt.evidence(null)).isNull();
        // 근거를 옮기다 출력 한도로 잘려도 글자가 있으면 답이 있는 것으로
        assertThat(prompt.evidence("{\"evidence\": \"김태형 감독이 더그아웃에서")).isEqualTo("김태형 감독이 더그아웃에서");
        assertThat(prompt.evidence("{\"evidence\": \"")).isNull();
    }

    @Test
    void 지금_장면_프롬프트와_첫_문장() {
        assertThat(prompt.sceneNowUser(context)).endsWith("\n\n요청: 지금 화면을 설명해 주세요.");
        assertThat(AnswerPrompt.sceneTitleSentence(context.currentScene())).isEqualTo("지금은 제로백 가속 테스트 장면이에요.");
    }

    @ParameterizedTest
    @ValueSource(strings = {"그건 해설 자료에 없어요.", "해설 자료에는 그 내용이 나오지 않아요.", "자료에 나와 있지 않아 알 수 없어요.",
            "해설에서는 알 수 없어요.", "해설 자료에는 토끼 인형이나 그에 대한 내용이 없어서 색깔은 알 수 없어요.",
            "해설 자료에는 솜사탕 기계 앞에서 눈을 반짝이는 어린 양이 나오지만, 그 양의 이름은 없어요.",
            "해설 자료에 다음 타자가 안타를 쳤는지 여부는 없어요.", "자료에서는 확인할 수 없어요."})
    void 자료에_없다는_답을_알아본다(String answer) {
        assertThat(AnswerPrompt.saidUnanswerable(answer)).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {"손흥민이 골을 넣었어요.", "차가 없어졌어요. 순식간에 사라졌어요.",
            "해설 자료에 따르면 농장에 남은 양은 없어요.", "자료를 보면 이 차는 지붕이 없어요.",
            "해설에서 그는 아무 말 없이 문을 열고 나가요.", "네, 해설 문장에 나온 대로 아무도 없는 방이에요.",
            "자료 화면 속 남자는 모자를 쓰고 있지 않아요.", "해설에서 그녀는 모자를 쓰고 있지 않아요."})
    void 보통_답은_자료에_없다는_답이_아니다(String answer) {
        assertThat(AnswerPrompt.saidUnanswerable(answer)).isFalse();
    }

    @Test
    void 장면_설명을_문장으로_나눠_앞에서부터_자른다() {
        assertThat(AnswerPrompt.sentencesOf("문이 열립니다. 핸들이 보입니다. 스포일러가 솟습니다", 2))
                .containsExactly("문이 열립니다.", "핸들이 보입니다.");
        assertThat(AnswerPrompt.clock(3_725_000)).isEqualTo("1:02:05");
    }
}
