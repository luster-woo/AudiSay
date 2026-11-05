package com.audisay.domain.chat.intent;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.assertThat;

class RuleIntentClassifierTest {
    private final RuleIntentClassifier classifier = new RuleIntentClassifier();

    /** 모델 비교 평가셋 20문장(backend/build/eval/eval_set.json). 규칙은 맞히거나 LLM에 넘기고, 틀리면 안 된다 */
    @ParameterizedTest(name = "{0} → {1}")
    @CsvSource(delimiter = '|', textBlock = """
            아까 그 남자 이름이 뭐였더라 | QUESTION
            저 사람 지금 손에 들고 있는 게 뭐야 | QUESTION
            그래서 결국 누가 이긴 거야 | QUESTION
            화면에 지금 뭐가 보이는지 말해 줄래 | SCENE_NOW
            지금 어떤 상황인지 좀 그려 줘 | SCENE_NOW
            일 분 삼십 초로 넘어가 줘 | SEEK_TIME target=90000
            삼십 초 전으로 돌아가 줘 | SEEK_TIME rel=-30000
            이분 십초로 이동 | SEEK_TIME target=130000
            반죽 튀기는 데 다시 보고 싶어 | LLM
            로켓 달린 차가 점프하던 거 한 번 더 | LLM
            엔딩 크레딧 나오는 데로 가자 | SEEK_SCENE q=엔딩 크레딧 나오는
            말 좀 천천히 해 줄래 | SETTING speechRate DOWN
            해설은 빼고 대사만 들을래 | SETTING soundMix=DIALOGUE_ONLY
            설명을 더 자세하게 해 줘 | SETTING detailLevel UP
            잠깐 세워 봐 | ACTION PAUSE
            이 영상 즐겨찾기에 넣어 둬 | ACTION FAVORITE_ADD
            내가 뭐라고 말하면 되는지 알려 줘 | ACTION HELP
            지금 몇 분쯤 왔어 | ACTION CURRENT_POSITION
            다음 장면으로 넘어가 | ACTION NEXT_SCENE
            음 아 아니에요 됐어요 | LLM
            """)
    void 평가셋(String utterance, String expected) {
        assertThat(format(classifier.classify(utterance))).isEqualTo(expected);
    }

    @ParameterizedTest(name = "{0} → {1}")
    @CsvSource(delimiter = '|', textBlock = """
            3분 20초로 가 줘 | SEEK_TIME target=200000
            3:20 | SEEK_TIME target=200000
            1분 30초 | SEEK_TIME target=90000
            2분 반 | SEEK_TIME target=150000
            한 시간 반으로 가 | SEEK_TIME target=5400000
            백이십 초로 | SEEK_TIME target=120000
            10초 뒤로 | SEEK_TIME rel=10000
            30초 넘겨 | SEEK_TIME rel=30000
            스물다섯 초 뒤로 | SEEK_TIME rel=25000
            5초만 앞으로 | SEEK_TIME rel=-5000
            십오 초 앞으로 | SEEK_TIME rel=-15000
            처음부터 다시 틀어 줘 | SEEK_TIME target=0
            이 영상 처음부터 틀어 줘 | SEEK_TIME target=0
            끝으로 가 | SEEK_TIME END
            1분 2분 | LLM
            처음부터 누가 나왔어? | QUESTION
            마지막으로 한 말이 뭐야 | QUESTION
            1분에 누가 나와? | QUESTION
            이분 누구야 | QUESTION
            두 분이 누구야 | QUESTION
            치즈케이크 만드는 영상 찾아 줘 | SEARCH_VIDEO q=치즈케이크 만드는
            고양이 영상 보여 줘 | SEARCH_VIDEO q=고양이
            유튜브에서 김치찌개 검색해 줘 | SEARCH_VIDEO q=김치찌개
            아까 본 영상 틀어 줘 | LLM
            신고해 줘 | UNKNOWN msg=신고는 신고 버튼으로 해 주세요.
            이 해설 틀렸어 신고할래 | UNKNOWN msg=신고는 신고 버튼으로 해 주세요.
            다시 말해 줘 | ACTION REPEAT_LAST
            방금 뭐라고 했어? | ACTION REPEAT_LAST
            방금 저 사람 뭐라고 했어? | QUESTION
            아까 거기로 돌아가 | ACTION UNDO_SEEK
            이동 취소 | ACTION UNDO_SEEK
            그만 읽어 | ACTION STOP_SPEAKING
            조용히 해 | ACTION STOP_SPEAKING
            재생 | ACTION PLAY
            계속 봐 | ACTION PLAY
            멈춰 | ACTION PAUSE
            일시정지 | ACTION PAUSE
            도움말 | ACTION HELP
            요약 들려줘 | ACTION PLAY_SUMMARY
            지금까지 줄거리 알려 줘 | RECAP
            여태 무슨 일 있었어? | RECAP
            앞에 내용 정리해 줘 | RECAP
            지금까지 어떻게 됐는지 요약해 줘 | RECAP
            지금까지 나온 사람 누구야 | QUESTION
            목차 열어 줘 | ACTION OPEN_CHAPTERS
            대본 보여 줘 | ACTION OPEN_SCRIPT
            질문 기록 보여줘 | ACTION OPEN_HISTORY
            즐겨찾기 해제 | ACTION FAVORITE_REMOVE
            튜토리얼 다시 듣기 | ACTION REPLAY_TUTORIAL
            화면 글자 자세히 읽어 줘 | ACTION READ_DETAIL
            얼마나 남았어 | ACTION CURRENT_POSITION
            지금 어디야 | ACTION CURRENT_POSITION
            지금 어디 가는 거야 | QUESTION
            재생 속도 올려 줘 | SETTING speechRate UP
            속도 1.5배로 | SETTING speechRate=1.5
            2배속 | SETTING speechRate=2.0
            더 빠르게 말해 줘 | SETTING speechRate UP
            해설 꺼 줘 | SETTING soundMix=DIALOGUE_ONLY
            해설 켜 줘 | SETTING soundMix=DIALOGUE_AND_NARRATION
            자막 읽지 마 | SETTING subtitleReading=OFF
            자막 다 읽어 줘 | SETTING subtitleReading=ALL
            상세도 3으로 | SETTING detailLevel=3
            상세도 올려 | SETTING detailLevel UP
            간단하게 설명해 줘 | SETTING detailLevel DOWN
            그 사람 누군지 자세히 말해 줘 | QUESTION
            소리 줄여 | SETTING originalVolume DOWN
            소리 50 | SETTING originalVolume=50
            음소거 | SETTING originalVolume=0
            글자 크게 | SETTING fontSizeLevel UP
            고대비 켜 줘 | SETTING highContrast=true
            골 넣는 장면으로 가 줘 | SEEK_SCENE q=골 넣는
            그 데이트 장면으로 가 | SEEK_SCENE q=데이트
            이 장면 설명해 줘 | SCENE_NOW
            무슨 장면이야 | SCENE_NOW
            왜 울어? | QUESTION
            레시피 알려줘 | LLM
            십 초 되돌려 | SEEK_TIME rel=-10000
            아까 거기로 되돌려 | ACTION UNDO_SEEK
            화면 뭐 나와 | SCENE_NOW
            지금 뭐 보여 | SCENE_NOW
            그 사람이 뭐 보여줬어 | QUESTION
            시작할 때 요약 항상 들려줘 | SETTING summaryMode=ALWAYS
            영상 틀 때마다 요약 물어봐 줘 | SETTING summaryMode=ASK
            처음에 요약 안 들을래 | SETTING summaryMode=NEVER
            요약 들려줘 | ACTION PLAY_SUMMARY
            너는 누구야 | UNKNOWN msg=저는 영상 내용을 알려 드리는 도우미예요. 영상에 대해 물어봐 주세요.
            넌 이름이 뭐야 | UNKNOWN msg=저는 영상 내용을 알려 드리는 도우미예요. 영상에 대해 물어봐 주세요.
            0.75배속으로 읽어 줘 | SETTING speechRate=0.8
            말 속도 1.5배로 | SETTING speechRate=1.5
            10배 빠르게 말해 | LLM
            10초 전에 뭐라고 했어 | QUESTION
            5분 뒤에 뭐 나와 | QUESTION
            1분 전에 나온 사람 누구야 | QUESTION
            주인공이 멈춰 서는 장면으로 가 줘 | SEEK_SCENE q=주인공이 멈춰 서는
            공을 되돌려 보내는 장면으로 가 줘 | SEEK_SCENE q=공을 되돌려 보내는
            말이 천천히 걷는 장면으로 가 줘 | SEEK_SCENE q=말이 천천히 걷는
            다음 장면에서 누가 나와 | LLM
            아까 그 장면으로 돌아가 | ACTION UNDO_SEEK
            소리 2배로 키워 줘 | SETTING originalVolume UP
            소리 50으로 | SETTING originalVolume=50
            볼륨 70 정도 | SETTING originalVolume=70
            앞 장면으로 가 줘 | ACTION PREV_SCENE
            전 장면으로 돌아가 줘 | ACTION PREV_SCENE
            바로 다음 장면으로 가 | ACTION NEXT_SCENE
            아까 보던 데로 가 줘 | ACTION UNDO_SEEK
            지금까지 무슨 내용이야 | RECAP
            바로 전 장면으로 돌아가 | ACTION PREV_SCENE
            방금 전 장면으로 가 줘 | ACTION PREV_SCENE
            그다음 장면 | ACTION NEXT_SCENE
            홈런 친 다음 장면 보여 줘 | LLM
            결혼식 이전 장면 보여 줘 | LLM
            지금까지 무슨 내용이었는지 알려 줘 | RECAP
            지금까지 범인이 무슨 얘기 했어 | QUESTION
            그럼 다음 장면으로 가 줘 | ACTION NEXT_SCENE
            빨리 이전 장면으로 | ACTION PREV_SCENE
            방금 전 장면 설명해 줘 | LLM
            응전 장면으로 가 줘 | SEEK_SCENE q=응전
            지난 내용 무슨 얘기였어 | RECAP
            홈런 직전 장면 보여 줘 | LLM
            소리 10 정도 올려 줘 | SETTING originalVolume UP
            볼륨 5 해도 돼 | LLM
            지금까지 무슨 내용으로 싸웠어 | QUESTION
            끝까지 봐 | LLM
            영상에서 홈런 검색해 줘 | LLM
            목차 몇 개야 | QUESTION
            지금까지 나온 내용 중에 범인이 누구야 | QUESTION
            """)
    void 규칙(String utterance, String expected) {
        assertThat(format(classifier.classify(utterance))).isEqualTo(expected);
    }

    private static String format(ClassifiedIntent x) {
        if (x == null) {
            return "LLM";
        }
        StringBuilder b = new StringBuilder(x.intent().name());
        if (x.targetMs() != null) {
            b.append(" target=").append(x.targetMs());
        }
        if (x.relativeMs() != null) {
            b.append(" rel=").append(x.relativeMs());
        }
        if (x.toEnd()) {
            b.append(" END");
        }
        if (x.query() != null) {
            b.append(" q=").append(x.query());
        }
        if (x.settingKey() != null) {
            b.append(" ").append(x.settingKey());
            if (x.settingValue() != null) {
                b.append("=").append(x.settingValue());
            }
            if (x.direction() != null) {
                b.append(" ").append(x.direction());
            }
        }
        if (x.actionCode() != null) {
            b.append(" ").append(x.actionCode());
        }
        if (x.message() != null) {
            b.append(" msg=").append(x.message());
        }
        return b.toString();
    }
}
