package com.audisay.domain.chat.intent;

import com.audisay.domain.chat.entity.ChatIntent;
import org.springframework.stereotype.Component;

import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 규칙 발화 분류. 확실한 말만 분류하고 애매하면 null(LLM이 분류)을 돌려준다 — 틀리게 분류하는 것보다 LLM에 넘기는 게 낫다.
 * 순서: 신고 → 영상 검색 → 시각 이동 → 지금까지 줄거리(RECAP) → 이동 취소 → 장면 이동 → 기능(ACTION) → 지금 장면 → 설정 → 질문.
 * 참고: AI 서버 ai/app/chat/intent.py by_rules. 바꾼 점은 모델 비교(claude_AudiSay_GMS_모델비교.md 5장)에서 틀린
 * 한글 숫자 시각·"화면에 뭐가 보여"·"뭐라고 말하면 돼" 처리, actionCode 17개, SEARCH_VIDEO, 신고
 */
@Component
public class RuleIntentClassifier {
    static final String REPORT_MESSAGE = "신고는 신고 버튼으로 해 주세요.";
    static final String SELF_MESSAGE = "저는 영상 내용을 알려 드리는 도우미예요. 영상에 대해 물어봐 주세요.";

    private static final Pattern TRAILING = Pattern.compile("[?!.~…\\s]+$");
    private static final Pattern SPACES = Pattern.compile("\\s+");

    private static final Pattern REPORT = Pattern.compile("신고");
    /** "너는 누구야"처럼 챗봇 자신에 대한 말은 영상 질문이 아니다 */
    private static final Pattern SELF = Pattern.compile("^(?:너|넌|당신)(?:은|는|이|가)?(?:누구|뭐야|뭐니|뭔데|이름)");
    /** "시작할 때 요약 항상 들려줘"는 요약 재생이 아니라 summaryMode 설정 */
    private static final Pattern SUMMARY_SETTING = Pattern.compile("항상|매번|자동|시작할때|시작하면|처음에|틀때마다|켤때마다");
    /** "지금까지 줄거리"·"여태 무슨 일 있었어"·"앞에 내용 정리해 줘" — 영상 전체 요약(PLAY_SUMMARY)보다 먼저 본다 */
    private static final Pattern RECAP_WHEN = Pattern.compile(
            "지금까지|여태|이때까지|여기까지|아까까지|앞(?:에|의)?(?:내용|이야기|부분)|지난(?:내용|이야기|부분)");
    /** 이전·다음 장면 명령 앞에 붙는 군말("그럼 다음 장면", "빨리 이전 장면으로"). 다른 말이 앞에 있으면 장면 찾기라 규칙으로 보지 않는다 */
    private static final String NAV_LEAD_WORDS = "바로|좀|그러면|그럼|이제|자|그냥|빨리|얼른|아까|방금|조금|다시|제발|여기서|저기|음|어|아|네|응|그";
    private static final String SCENE_NAV_LEAD = "(?:(?:" + NAV_LEAD_WORDS + "|한번더|이번엔)[,.~]?){0,2}";
    private static final Pattern RELATIVE_SCENE = Pattern.compile(
            "(?:(?:" + NAV_LEAD_WORDS + "|한\\s*번\\s*더|이번엔)[,.~]?\\s*){0,2}(?:그\\s*)?(?:다음|이전|전|앞|앞에|지난|직전|그전)(?<![자어아음네응]전)");
    /** 이동이 아니라 그 장면을 묻는 말("방금 전 장면 설명해 줘"), 고르는 말("이전 장면 말고 다음 장면") */
    private static final Pattern NAV_NOT_MOVE = Pattern.compile("설명|알려|말해|묘사|읽어|들려|말고");
    private static final Pattern RECAP_WHAT = Pattern.compile("줄거리|요약|정리|무슨일|무슨이야기|어떻게됐|어떤내용|있었"
            // "지금까지 어떻게 만들었어"·"여태 뭐 했어" — 지금까지 바로 뒤에 붙을 때만("지금까지 소스는 어떻게 만들었어"는 질문)
            + "|(?:지금까지|여태까지|여태|이때까지|여기까지)(?:는)?(?:어떻게|뭘|뭐)(?:만들|했|진행|흘러)"
            + "|(?:지금까지|여태까지|여태|이때까지|여기까지|아까까지|지난(?:내용|이야기|부분))(?:의|영상|(?:본|나온)(?:거|게|것은?)?)?(?:이|은|는|가)?무슨(?:내용|얘기)(?!으로|을|를|에서|때문|이제일|이중요)");
    /** "지금까지 내용"처럼 약한 말은 질문 낱말이 없을 때만 RECAP("지금까지 나온 내용 중에 범인이 누구야"는 질문) */
    private static final Pattern RECAP_WHAT_WEAK = Pattern.compile("내용|이야기");
    private static final Pattern SEARCH_VIDEO = Pattern.compile(
            "^(?:유튜브에서\\s*)?(.+?)\\s*(?:관련\\s*)?(?:영상|동영상)\\s*(?:을|를|좀|하나)?\\s*(?:찾아|검색|찾고|보고\\s*싶|틀어|보여)");
    private static final Pattern SEARCH_KEYWORD = Pattern.compile("^(?:유튜브에서\\s*)?(.+?)\\s*(?:을|를)?\\s*(?:유튜브에서\\s*)?검색");
    private static final Set<String> VAGUE_QUERIES = Set.of("이", "그", "저", "다른", "아무", "새", "비슷한", "다음", "이전",
            "이거", "그거", "좋은", "재밌는", "아무거나");
    private static final Pattern VAGUE_PREFIX = Pattern.compile(
            "^(?:(?:이\\s*)?영상\\s*(?:에서|안에서|속에서)|아까|방금|이전에|전에|지금|이|그|저|이번)(?:\\s|$)");
    private static final Set<String> VAGUE_SCENES = Set.of("처음", "첫", "마지막", "끝", "다음", "이전", "아까", "거기");

    private static final String MOVE_TAIL = "(?:\\s*(?:다시\\s*)?(?:가|이동|돌아가|넘어가|넘겨|돌려|틀어|재생|보여|봐|볼래|보자|들려|점프|옮겨)[가-힣\\s]*)?$";
    private static final Pattern TO_START = Pattern.compile("^(?:(?:이\\s*)?영상\\s*)?(?:맨\\s*)?처음\\s*(?:으로|부터)" + MOVE_TAIL);
    /** "끝까지 봐"·"끝까지 틀어"는 끝으로 가는 게 아니라 계속 보는 것이라 "으로"만 */
    private static final Pattern TO_END = Pattern.compile("^(?:(?:이\\s*)?영상\\s*)?(?:맨\\s*끝|끝|마지막)\\s*으로" + MOVE_TAIL);
    /** "후반 30분"·"전반전 10분"은 영상 시각이 아니라 경기 시각이다 — 시각 이동이 아니라 그 장면 찾기로 */
    private static final Pattern MATCH_CLOCK = Pattern.compile("(?:전반|후반|연장)(?:\\s*전)?$");
    /** "이동 간격 30초로"는 시각 이동이 아니라 이동 간격(seekStepSec) 설정 */
    private static final Pattern STEP_SETTING = Pattern.compile("(?:간격|단위)(?:을|를|은|는)?(5|10|30|오|십|삼십)초");
    private static final Pattern AFTER_ABSOLUTE = Pattern.compile("^\\s*(?:으로|로)(?![가-힣])");
    private static final Pattern AFTER_BACKWARD = Pattern.compile(
            "^\\s*(?:만\\s*)?(?:전으로|전|이전으로|앞으로|앞에|되감|되돌|돌려|돌아가|앞당겨)");
    private static final Pattern AFTER_FORWARD = Pattern.compile(
            "^\\s*(?:만\\s*)?(?:뒤로|뒤에|후로|후에|이후로|지나서|넘겨|건너|빨리\\s*감)");
    private static final Pattern AFTER_MOVE = Pattern.compile(
            "^\\s*(?:에서|부터)?\\s*(?:다시\\s*)?(?:가|이동|넘어가|돌아가|틀어|재생|점프|옮겨|보여)");

    private static final Pattern SCENE_NOW = Pattern.compile(
            "화면(?:에|엔)?(?:지금)?(?:뭐|무엇|무슨)|^(?:지금)?뭐(?:보여|나와|나오)(?:요|니|냐)?$|(?:지금|이)(?:장면|화면)(?:을|이|은)?(?:설명|묘사|뭐|어때|알려)"
                    + "|뭐가(?:보여|보이|나와)|무슨장면이야|어떤(?:상황|장면)이야|어떤상황인지|지금상황(?:이|을)?(?:어때|설명|알려|그려)");
    private static final Pattern SEEK_SCENE = Pattern.compile(
            "^(.+?)\\s*(?:장면|부분|데|곳|때)\\s*(?:으로|로)\\s*(?:다시\\s*)?(?:가|이동|넘어가|돌아가|보여|틀어|옮겨)");
    private static final Pattern QUESTION = Pattern.compile("누구|누가|누굴|누군|왜|어떻게|무엇|뭐|무슨|몇|어느|어디|언제|얼마|궁금");
    private static final Pattern SCENE_WORD = Pattern.compile("장면|부분|나오는데|나온데");
    /** 시각 뒤에 질문·설명 요청이 오면 이동이 아니다("10초 전에 뭐라고 했어", "3분 전 장면 설명해 줘") */
    private static final Pattern ASK_AFTER_TIME = Pattern.compile("누구|누가|누굴|누군|왜|어떻게|무엇|뭐|무슨|몇|어느|어디|언제|얼마|궁금|설명|알려|말해|묘사");
    /** 장면 이동보다 먼저 보는 이동 취소("아까 그 장면으로 돌아가" — 장면 이름이 아니라 직전 위치) */
    private static final Pattern UNDO_PLACE = Pattern.compile(
            "이동취소|원래(?:보던|있던)?(?:데|곳|위치|자리)로|아까(?:보던|그|있던)?(?:데|곳|위치|자리|거기)(?:으)?로|아까(?:보던|그|있던)?장면으로(?:다시)?돌아|이전위치로");
    /** 질문이면 실행하지 않는 기능("목차 몇 개야", "재생 버튼 어디 있어", "다음 장면에서 누가 나와") */
    private static final Set<ActionCode> NOT_FOR_QUESTION = Set.of(ActionCode.NEXT_SCENE, ActionCode.PREV_SCENE,
            ActionCode.OPEN_CHAPTERS, ActionCode.OPEN_SCRIPT, ActionCode.OPEN_HISTORY, ActionCode.PAUSE, ActionCode.PLAY,
            ActionCode.FAVORITE_ADD, ActionCode.FAVORITE_REMOVE);

    public ClassifiedIntent classify(String utterance) {
        String s = SPACES.matcher(TRAILING.matcher(utterance.strip()).replaceAll("")).replaceAll(" ");
        String c = s.replace(" ", "").toLowerCase(Locale.ROOT);
        if (c.isEmpty()) {
            return null;
        }
        // "신고하는 장면으로 가 줘"는 신고가 아니라 장면 찾기
        if (REPORT.matcher(c).find() && seekScene(s) == null) {
            return ClassifiedIntent.unknown(REPORT_MESSAGE);
        }
        if (SELF.matcher(c).find()) {
            return ClassifiedIntent.unknown(SELF_MESSAGE);
        }
        boolean question = QUESTION.matcher(c).find();
        ClassifiedIntent result = searchVideo(s);
        if (result == null) {
            result = seekTime(s);
        }
        if (result == null && RECAP_WHEN.matcher(c).find()
                && (RECAP_WHAT.matcher(c).find() || (!question && RECAP_WHAT_WEAK.matcher(c).find()))) {
            result = ClassifiedIntent.of(ChatIntent.RECAP);
        }
        if (result == null && UNDO_PLACE.matcher(c).find()) {
            result = ClassifiedIntent.action(ActionCode.UNDO_SEEK);
        }
        if (result == null) {
            // 장면 이동을 기능·설정보다 먼저: "멈춰 서는 장면으로 가 줘"는 일시정지가 아니고 "천천히 걷는 장면"은 말하기 속도가 아니다
            result = seekScene(s);
        }
        if (result == null) {
            result = action(c, question);
        }
        if (result == null && SCENE_NOW.matcher(c).find()) {
            result = ClassifiedIntent.of(ChatIntent.SCENE_NOW);
        }
        if (result == null) {
            result = setting(c);
        }
        if (result == null && QUESTION.matcher(c).find() && !SCENE_WORD.matcher(c).find()) {
            result = ClassifiedIntent.of(ChatIntent.QUESTION);
        }
        return result;
    }

    private static ClassifiedIntent searchVideo(String s) {
        for (Pattern p : new Pattern[]{SEARCH_VIDEO, SEARCH_KEYWORD}) {
            Matcher m = p.matcher(s);
            if (m.find()) {
                String query = m.group(1).strip();
                return query.isEmpty() || VAGUE_QUERIES.contains(query) || VAGUE_PREFIX.matcher(query).find()
                        ? null : ClassifiedIntent.searchVideo(query);
            }
        }
        return null;
    }

    private static ClassifiedIntent seekTime(String s) {
        if (TO_START.matcher(s).find()) {
            return ClassifiedIntent.seekTo(0);
        }
        if (TO_END.matcher(s).find()) {
            return ClassifiedIntent.seekToEnd();
        }
        KoreanTime.Match time = KoreanTime.find(s);
        if (time == null) {
            return null;
        }
        String before = s.substring(0, time.start()).strip();
        String after = s.substring(time.end());
        if (STEP_SETTING.matcher(s.replace(" ", "")).find()) {
            return null;
        }
        if (MATCH_CLOCK.matcher(before).find()) {
            return ClassifiedIntent.seekScene(s.substring(0, time.end()).strip());
        }
        if (ASK_AFTER_TIME.matcher(after.replace(" ", "")).find()) {
            return null;
        }
        if (AFTER_ABSOLUTE.matcher(after).find()) {
            return ClassifiedIntent.seekTo(time.ms());
        }
        if (AFTER_BACKWARD.matcher(after).find()) {
            return ClassifiedIntent.seekBy(-time.ms());
        }
        if (AFTER_FORWARD.matcher(after).find()) {
            return ClassifiedIntent.seekBy(time.ms());
        }
        if (AFTER_MOVE.matcher(after).find() || (before.isEmpty() && after.isBlank())) {
            return ClassifiedIntent.seekTo(time.ms());
        }
        return null;
    }

    private static ClassifiedIntent action(String c, boolean question) {
        ActionCode code = actionCode(c);
        if (code == null || (question && NOT_FOR_QUESTION.contains(code))) {
            return null;
        }
        if ((code == ActionCode.NEXT_SCENE || code == ActionCode.PREV_SCENE) && NAV_NOT_MOVE.matcher(c).find()) {
            return null;
        }
        return ClassifiedIntent.action(code);
    }

    private static ActionCode actionCode(String c) {
        if (find(c, "즐겨찾기")) {
            return find(c, "빼|삭제|해제|취소|지워|없애") ? ActionCode.FAVORITE_REMOVE : ActionCode.FAVORITE_ADD;
        }
        if (!find(c, "자막") && find(c, "그만(?:읽|말)|읽지마|말하지마|조용히|음성(?:만)?(?:멈|꺼|그만)|해설그만|건너뛰어|그만해")) {
            return ActionCode.STOP_SPEAKING;
        }
        if (find(c, "요약") && !SUMMARY_SETTING.matcher(c).find() && find(c, "들려|읽어|틀어|해줘|보여|말해|재생|요약해")) {
            return ActionCode.PLAY_SUMMARY;
        }
        // "튜토리얼 다시 들려줘"는 방금 말 다시가 아니라 튜토리얼
        if (find(c, "튜토리얼|사용법(?:을)?다시|처음설명다시")) {
            return ActionCode.REPLAY_TUTORIAL;
        }
        if (find(c, "다시(?:말|읽|들려)|한번더(?:말|읽|들려)|못들었|^(?:방금)?뭐라고(?:했|그랬)(?:어|지|나요|어요|니)?$")) {
            return ActionCode.REPEAT_LAST;
        }
        if (find(c, "이동취소|되돌려|원래(?:보던|있던)?(?:데|곳|위치|자리)로|아까(?:보던|그|있던)?(?:데|곳|위치|자리|거기)로|이전위치로")) {
            return ActionCode.UNDO_SEEK;
        }
        // 문장 처음에 올 때만: "홈런 친 다음 장면 보여 줘", "결혼식 이전 장면"은 장면 찾기라 LLM이 분류
        if (find(c, "^" + SCENE_NAV_LEAD + "(?:그)?다음(?:장면|챕터|목차)")) {
            return ActionCode.NEXT_SCENE;
        }
        if (find(c, "^" + SCENE_NAV_LEAD + "(?:이전|앞|앞에|지난|직전|그전|(?<![자어아음네응])전)(?:장면|챕터|목차)")) {
            return ActionCode.PREV_SCENE;
        }
        if (find(c, "지금몇분|몇분(?:쯤|째)?(?:이야|야|이에요|인데|왔|됐)|어디까지(?:봤|왔)|^(?:지금)?어디(?:쯤)?(?:이야|야|에요|예요|인가요|지)?$|얼마나남았|남은시간|몇분남았")) {
            return ActionCode.CURRENT_POSITION;
        }
        if (find(c, "(?:화면|영상)?(?:글자|글씨|텍스트)(?:를|좀)?(?:자세히|다|전부)?읽")) {
            return ActionCode.READ_DETAIL;
        }
        if (find(c, "도움말|뭐라고말하면|어떻게말하면|무슨말(?:을)?하면|쓸수있는(?:말|명령)|명령어|사용법")) {
            return ActionCode.HELP;
        }
        if (find(c, "목차|장면목록|챕터목록")) {
            return ActionCode.OPEN_CHAPTERS;
        }
        if (find(c, "대본|해설목록|스크립트")) {
            return ActionCode.OPEN_SCRIPT;
        }
        if (find(c, "질문기록|질문목록|대화기록|물어본거")) {
            return ActionCode.OPEN_HISTORY;
        }
        if (find(c, "일시정지|멈춰|멈춤|정지|스톱|세워|^잠깐(?:만|기다려)?$")) {
            return ActionCode.PAUSE;
        }
        if (find(c, "^(?!.*속도)(?:(?:다시|계속|이어서)?(?:재생|틀어)|(?:계속|이어서)(?:봐|볼래|보자))")) {
            return ActionCode.PLAY;
        }
        return null;
    }

    private static ClassifiedIntent setting(String c) {
        boolean question = QUESTION.matcher(c).find();
        if (find(c, "요약") && SUMMARY_SETTING.matcher(c).find()) {
            if (find(c, "안들|듣지않|들려주지마|꺼|끄|빼|없이|필요없|싫")) {
                return ClassifiedIntent.setting("summaryMode", "NEVER");
            }
            return ClassifiedIntent.setting("summaryMode", find(c, "물어|묻(?!지말)") ? "ASK" : "ALWAYS");
        }
        Matcher step = STEP_SETTING.matcher(c);
        if (step.find()) {
            String n = step.group(1);
            return ClassifiedIntent.setting("seekStepSec", switch (n) {
                case "오" -> "5";
                case "십" -> "10";
                case "삼십" -> "30";
                default -> n;
            });
        }
        if (find(c, "고대비")) {
            return ClassifiedIntent.setting("highContrast", find(c, "꺼|끄|해제|없애") ? "false" : "true");
        }
        if (find(c, "대사만|해설(?:은|을|좀)?(?:꺼|끄|빼|없이|안들)")) {
            return ClassifiedIntent.setting("soundMix", "DIALOGUE_ONLY");
        }
        if (find(c, "해설(?:을|좀|다시)?(?:켜|넣|같이)")) {
            return ClassifiedIntent.setting("soundMix", "DIALOGUE_AND_NARRATION");
        }
        // "외국어 번역 꺼 줘", "번역 읽어 줘". "번역 자막만"은 아래 자막 읽기 설정
        if (!find(c, "자막") && find(c, "번역|외국어")) {
            if (find(c, "꺼|끄|읽지마|안읽|그만|빼")) {
                return ClassifiedIntent.setting("translationReading", "false");
            }
            if (find(c, "켜|읽어|들려|넣")) {
                return ClassifiedIntent.setting("translationReading", "true");
            }
        }
        if (find(c, "자막")) {
            if (find(c, "꺼|끄|읽지마|안읽|그만")) {
                return ClassifiedIntent.setting("subtitleReading", "OFF");
            }
            // "자막 다를 때만 읽어"의 '다'를 '다(전부)'로 읽지 않게 먼저 본다
            if (find(c, "(?:다른|번역|외국어)자막만|다를때만|다른것만|다를때")) {
                return ClassifiedIntent.setting("subtitleReading", "DIFFERENT_ONLY");
            }
            if (find(c, "자막(?:을|은)?(?:다|모두|전부)")) {
                return ClassifiedIntent.setting("subtitleReading", "ALL");
            }
            return null;
        }
        ClassifiedIntent detail = detailLevel(c, question);
        if (detail != null) {
            return detail;
        }
        ClassifiedIntent rate = speechRate(c, question);
        if (rate != null) {
            return rate;
        }
        if (find(c, "(?:글자|글씨)(?:를|좀)?(?:더)?(?:크게|키워)")) {
            return ClassifiedIntent.settingStep("fontSizeLevel", SettingDirection.UP);
        }
        if (find(c, "(?:글자|글씨)(?:를|좀)?(?:더)?(?:작게|줄여)")) {
            return ClassifiedIntent.settingStep("fontSizeLevel", SettingDirection.DOWN);
        }
        if (find(c, "음소거|소리(?:를|좀)?꺼")) {
            return ClassifiedIntent.setting("originalVolume", "0");
        }
        if (find(c, "(?:소리|볼륨|음량)")) {
            // 숫자 뒤가 끝·"으로"·"%"일 때만 그 값으로("소리 2배로 키워"·"소리 10 올려"는 값이 아니라 올리기)
            Matcher n = Pattern.compile("(?:소리|볼륨|음량)(?:를|을)?(\\d{1,3})(?=$|으로|로|%|퍼센트|프로|에맞춰|맞춰|정도(?:로|$)|해(?:줘|주세요|서|놔|놓|$))").matcher(c);
            if (n.find()) {
                return ClassifiedIntent.setting("originalVolume", String.valueOf(Math.min(100, Integer.parseInt(n.group(1)))));
            }
            if (find(c, "키워|크게|올려|높여")) {
                return ClassifiedIntent.settingStep("originalVolume", SettingDirection.UP);
            }
            if (find(c, "줄여|작게|낮춰|내려")) {
                return ClassifiedIntent.settingStep("originalVolume", SettingDirection.DOWN);
            }
        }
        return null;
    }

    /** question이면 "자세히 말해 줘"류 상대 변경은 질문일 수 있어 LLM에 넘긴다 */
    private static ClassifiedIntent detailLevel(String c, boolean question) {
        Matcher level = Pattern.compile("상세도(?:를|을)?([1-3일이삼]|한|두|세)(?:단계|으로|로|$)").matcher(c);
        if (level.find()) {
            return ClassifiedIntent.setting("detailLevel", String.valueOf(KoreanTime.number(level.group(1))));
        }
        if (find(c, "상세도")) {
            if (find(c, "최대|제일높|가장높")) {
                return ClassifiedIntent.setting("detailLevel", "3");
            }
            if (find(c, "최소|제일낮|가장낮")) {
                return ClassifiedIntent.setting("detailLevel", "1");
            }
            if (find(c, "올려|높여|키워")) {
                return ClassifiedIntent.settingStep("detailLevel", SettingDirection.UP);
            }
            if (find(c, "내려|낮춰|줄여")) {
                return ClassifiedIntent.settingStep("detailLevel", SettingDirection.DOWN);
            }
            return null;
        }
        if (question) {
            return null;
        }
        if (find(c, "(?:자세히|자세하게|길게)(?:좀)?(?:해설|설명|말해|들려|해줘|해주세요)")) {
            return ClassifiedIntent.settingStep("detailLevel", SettingDirection.UP);
        }
        if (find(c, "(?:간단히|간단하게|짧게|간략하게|간략히)(?:좀)?(?:해설|설명|말해|들려|해줘|해주세요)")) {
            return ClassifiedIntent.settingStep("detailLevel", SettingDirection.DOWN);
        }
        return null;
    }

    private static ClassifiedIntent speechRate(String c, boolean question) {
        // 숫자 전체를 읽는다("0.75배속"을 "5배"로, "10배"를 "0배"로 읽지 않게). 0.5~2.5 밖이면 LLM에
        Matcher times = Pattern.compile("(?<![\\d.])(\\d+(?:\\.\\d+)?)배(?:속)?").matcher(c);
        if (times.find() && find(c, "속도|배속|말|읽")) {
            double rate = Double.parseDouble(times.group(1));
            if (rate < 0.5 || rate > 2.5) {
                return null;
            }
            return ClassifiedIntent.setting("speechRate", String.format(Locale.ROOT, "%.1f", rate));
        }
        boolean aboutSpeech = !question && find(c, "속도|말|읽|해설|목소리");
        if (aboutSpeech && find(c, "원래(?:대로|속도)|보통속도|기본속도")) {
            return ClassifiedIntent.setting("speechRate", "1.0");
        }
        if (aboutSpeech && find(c, "빠르|빨리|속도(?:를|좀)?(?:올려|높여)")) {
            return ClassifiedIntent.settingStep("speechRate", SettingDirection.UP);
        }
        if (aboutSpeech && find(c, "천천히|느리|느긋|속도(?:를|좀)?(?:내려|낮춰|줄여)")) {
            return ClassifiedIntent.settingStep("speechRate", SettingDirection.DOWN);
        }
        return null;
    }

    private static ClassifiedIntent seekScene(String s) {
        Matcher m = SEEK_SCENE.matcher(s);
        if (!m.find()) {
            return null;
        }
        String query = m.group(1).strip().replaceFirst("^(?:(?:아까|그|저|그때|이)(?:\\s+|$))+", "");
        // "앞 장면으로", "바로 다음 장면으로"는 장면 검색이 아니라 이전·다음 장면 기능
        return query.isEmpty() || VAGUE_SCENES.contains(query) || RELATIVE_SCENE.matcher(query).matches()
                ? null : ClassifiedIntent.seekScene(query);
    }

    private static boolean find(String c, String regex) {
        return Pattern.compile(regex).matcher(c).find();
    }
}
