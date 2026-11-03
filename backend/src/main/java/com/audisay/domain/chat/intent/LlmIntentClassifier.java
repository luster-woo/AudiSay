package com.audisay.domain.chat.intent;

import com.audisay.global.exception.BusinessException;
import com.audisay.global.external.llm.LlmClient;
import com.audisay.global.external.llm.LlmException;
import com.audisay.global.external.llm.LlmPurpose;
import com.audisay.global.external.llm.LlmRequest;
import com.audisay.global.external.llm.LlmResult;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

import java.util.Map;

/**
 * 규칙으로 분류하지 못한 말을 LLM(gemini-3.1-flash-lite, 장애 때 claude-haiku-5-5)에 JSON으로 묻는다.
 * 프롬프트는 모델 비교 스파이크(backend/build/eval/compare_models.py INTENT_SYSTEM)에 설정 10개·상대 변경·끝으로를 더한 것
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class LlmIntentClassifier {
    static final int MAX_OUTPUT_TOKENS = 200;
    static final String SYSTEM = """
            시각장애인이 영상을 보다가 챗봇에 한 말을 분류하세요. 설명 없이 JSON 한 개만 답하세요: {"intent": "...", "slots": {...}}
            - QUESTION: 영상 내용에 대한 질문(누구, 왜, 무엇, 몇, 영상 제목). slots {}
            - SCENE_NOW: 지금 화면·장면·상황을 설명해 달라는 말. slots {}
            - SEEK_TIME: 특정 시각으로, 또는 지금보다 몇 초·몇 분 앞뒤로 이동. slots {"targetMs": 영상 처음부터의 ms} 또는 {"relativeMs": 지금 기준 ms} 또는 {"toEnd": true}(영상 끝으로). 한글 숫자도 계산(일 분 삼십 초 = 90000). "뒤로·후로·넘겨"는 +, "앞으로·전으로·되돌려"는 -
            - SEEK_SCENE: 장면 내용으로 찾아 이동. slots {"query": 찾을 장면을 짧게}
            - SETTING: 재생 설정 변경. 값을 말했으면 {"settingKey": ..., "settingValue": 문자열}, 올리기·내리기만 말했으면 {"settingKey": ..., "direction": "UP" 또는 "DOWN"}
              숫자(direction 가능): detailLevel 1~3(해설 상세도, 자세히 UP·간단히 DOWN) / speechRate 0.5~2.5(말하기 속도, 빠르게 UP·천천히 DOWN) / originalVolume 0~100(영상 소리 크기) / fontSizeLevel 1~5(글자 크기)
              값 고르기: narrationMode AUTO·WITH_VIDEO(영상과 함께 읽기)·PAUSE_AFTER(영상을 멈추고 읽기) / soundMix DIALOGUE_ONLY(해설 끄기)·DIALOGUE_AND_NARRATION(해설 켜기) / subtitleReading ALL·DIFFERENT_ONLY·OFF(자막 읽기) / seekStepSec 5·10·30(이동 단위 초) / summaryMode ASK·ALWAYS·NEVER(시작할 때 30초 요약) / highContrast true·false(고대비 화면)
            - ACTION: 기능 실행. slots {"actionCode": ...}
              PLAY, PAUSE, CURRENT_POSITION(지금 위치·몇 분인지·얼마나 남았는지), NEXT_SCENE, PREV_SCENE, PLAY_SUMMARY(요약 듣기), READ_DETAIL(화면 글자 자세히), HELP(도움말·쓸 수 있는 말), OPEN_CHAPTERS, OPEN_SCRIPT, OPEN_HISTORY, FAVORITE_ADD, FAVORITE_REMOVE, REPLAY_TUTORIAL, REPEAT_LAST(방금 읽은 해설·답변 다시), UNDO_SEEK(이동 전 위치로 되돌리기), STOP_SPEAKING(읽는 음성만 멈춤)
            - SEARCH_VIDEO: 지금 영상이 아닌 다른 영상을 찾아 달라는 말. slots {"query": 검색어만}
            - UNKNOWN: 위 어느 것도 아니거나 알아들을 수 없음. 신고해 달라는 말도 UNKNOWN. slots {}""";

    private final LlmClient llmClient;
    private final ObjectMapper objectMapper;

    /** LLM 장애·한도·시간 초과는 CHAT_005·007·006. 안전 정책 거부와 읽을 수 없는 응답은 UNKNOWN */
    public ClassifiedIntent classify(String utterance, Long chatLogId) {
        LlmResult result;
        try {
            result = llmClient.generate(LlmRequest.json(LlmPurpose.INTENT, SYSTEM, "말: " + utterance, MAX_OUTPUT_TOKENS)
                    .withChatLogId(chatLogId));
        } catch (LlmException e) {
            if (e.getKind() == LlmException.Kind.BLOCKED) {
                return ClassifiedIntent.unknown(null);
            }
            throw new BusinessException(e.getKind().errorCode());
        }
        return parse(result.text(), utterance);
    }

    ClassifiedIntent parse(String text, String utterance) {
        String json = extractJson(text);
        if (json == null) {
            log.warn("발화 분류 응답이 JSON이 아닙니다: {}", abbreviate(text));
            return ClassifiedIntent.unknown(null);
        }
        try {
            IntentJson parsed = objectMapper.readValue(json, IntentJson.class);
            return IntentSlotMapper.map(parsed.intent(), parsed.slots(), utterance);
        } catch (JacksonException e) {
            log.warn("발화 분류 응답을 읽지 못했습니다: {}", abbreviate(text));
            return ClassifiedIntent.unknown(null);
        }
    }

    /** ```json 감싸기·앞뒤 설명이 붙어도 첫 { 부터 마지막 } 까지 */
    private static String extractJson(String text) {
        if (text == null) {
            return null;
        }
        int start = text.indexOf('{');
        int end = text.lastIndexOf('}');
        return start < 0 || end <= start ? null : text.substring(start, end + 1);
    }

    private static String abbreviate(String text) {
        return text == null ? null : text.length() > 200 ? text.substring(0, 200) + "…" : text;
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record IntentJson(String intent, Map<String, Object> slots) {
    }
}
