package com.audisay.domain.chat.intent;

import com.audisay.domain.chat.entity.ChatIntent;
import org.springframework.stereotype.Component;

import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 규칙 발화 분류. 확실한 말만 분류하고 애매하면 null(LLM이 분류)을 돌려준다 — 틀리게 분류하는 것보다 LLM에 넘기는 게 낫다.
 * 순서: 신고 → 영상 검색 → 시각 이동 → 기능(ACTION) → 지금 장면 → 설정 → 장면 이동 → 질문.
 * 참고: AI 서버 ai/app/chat/intent.py by_rules. 바꾼 점은 모델 비교(claude_AudiSay_GMS_모델비교.md 5장)에서 틀린
 * 한글 숫자 시각·"화면에 뭐가 보여"·"뭐라고 말하면 돼" 처리, actionCode 17개, SEARCH_VIDEO, 신고
 */
@Component
public class RuleIntentClassifier {
    static final String REPORT_MESSAGE = "신고는 신고 버튼으로 해 주세요.";

    private static final Pattern TRAILING = Pattern.compile("[?!.~…\\s]+$");
    private static final Pattern SPACES = Pattern.compile("\\s+");

    private static final Pattern REPORT = Pattern.compile("신고");
    private static final Pattern SEARCH_VIDEO = Pattern.compile(
            "^(?:유튜브에서\\s*)?(.+?)\\s*(?:관련\\s*)?(?:영상|동영상)\\s*(?:을|를|좀|하나)?\\s*(?:찾아|검색|찾고|보고\\s*싶|틀어|보여)");
    private static final Pattern SEARCH_KEYWORD = Pattern.compile("^(?:유튜브에서\\s*)?(.+?)\\s*(?:을|를)?\\s*(?:유튜브에서\\s*)?검색");
    private static final Set<String> VAGUE_QUERIES = Set.of("이", "그", "저", "다른", "아무", "새", "비슷한", "다음", "이전",
            "이거", "그거", "좋은", "재밌는", "아무거나");
    private static final Pattern VAGUE_PREFIX = Pattern.compile("^(?:아까|방금|이전에|전에|지금|이|그|저|이번)(?:\\s|$)");
    private static final Set<String> VAGUE_SCENES = Set.of("처음", "첫", "마지막", "끝", "다음", "이전", "아까", "거기");

    private static final String MOVE_TAIL = "(?:\\s*(?:다시\\s*)?(?:가|이동|돌아가|넘어가|넘겨|돌려|틀어|재생|보여|봐|볼래|보자|들려|점프|옮겨)[가-힣\\s]*)?$";
    private static final Pattern TO_START = Pattern.compile("^(?:(?:이\\s*)?영상\\s*)?(?:맨\\s*)?처음\\s*(?:으로|부터)" + MOVE_TAIL);
    private static final Pattern TO_END = Pattern.compile("^(?:(?:이\\s*)?영상\\s*)?(?:맨\\s*끝|끝|마지막)\\s*(?:으로|까지)" + MOVE_TAIL);
    private static final Pattern AFTER_ABSOLUTE = Pattern.compile("^\\s*(?:으로|로)(?![가-힣])");
    private static final Pattern AFTER_BACKWARD = Pattern.compile(
            "^\\s*(?:만\\s*)?(?:전으로|전|이전으로|앞으로|앞에|되감|돌려|돌아가|앞당겨)");
    private static final Pattern AFTER_FORWARD = Pattern.compile(
            "^\\s*(?:만\\s*)?(?:뒤로|뒤에|후로|후에|이후로|지나서|넘겨|건너|빨리\\s*감)");
    private static final Pattern AFTER_MOVE = Pattern.compile(
            "^\\s*(?:에서|부터)?\\s*(?:다시\\s*)?(?:가|이동|넘어가|돌아가|틀어|재생|점프|옮겨|보여)");

    private static final Pattern SCENE_NOW = Pattern.compile(
            "화면에(?:지금)?(?:뭐|무엇|무슨)|(?:지금|이)(?:장면|화면)(?:을|이|은)?(?:설명|묘사|뭐|어때|알려)"
                    + "|뭐가(?:보여|보이|나와)|무슨장면이야|어떤(?:상황|장면)이야|어떤상황인지|지금상황(?:이|을)?(?:어때|설명|알려|그려)");
    private static final Pattern SEEK_SCENE = Pattern.compile(
            "^(.+?)\\s*(?:장면|부분|데|곳|때)\\s*(?:으로|로)\\s*(?:다시\\s*)?(?:가|이동|넘어가|돌아가|보여|틀어|옮겨)");
    private static final Pattern QUESTION = Pattern.compile("누구|누가|누굴|누군|왜|어떻게|무엇|뭐|무슨|몇|어느|어디|언제|얼마|궁금");
    private static final Pattern SCENE_WORD = Pattern.compile("장면|부분|나오는데|나온데");

    public ClassifiedIntent classify(String utterance) {
        String s = SPACES.matcher(TRAILING.matcher(utterance.strip()).replaceAll("")).replaceAll(" ");
        String c = s.replace(" ", "").toLowerCase(Locale.ROOT);
        if (c.isEmpty()) {
            return null;
        }
        if (REPORT.matcher(c).find()) {
            return ClassifiedIntent.unknown(REPORT_MESSAGE);
        }
        ClassifiedIntent result = searchVideo(s);
        if (result == null) {
            result = seekTime(s);
        }
        if (result == null) {
            result = action(c);
        }
        if (result == null && SCENE_NOW.matcher(c).find()) {
            result = ClassifiedIntent.of(ChatIntent.SCENE_NOW);
        }
        if (result == null) {
            result = setting(c);
        }
        if (result == null) {
            result = seekScene(s);
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

    private static ClassifiedIntent action(String c) {
        ActionCode code = actionCode(c);
        return code == null ? null : ClassifiedIntent.action(code);
    }

    private static ActionCode actionCode(String c) {
        if (find(c, "즐겨찾기")) {
            return find(c, "빼|삭제|해제|취소|지워|없애") ? ActionCode.FAVORITE_REMOVE : ActionCode.FAVORITE_ADD;
        }
        if (!find(c, "자막") && find(c, "그만(?:읽|말)|읽지마|말하지마|조용히|음성(?:만)?(?:멈|꺼|그만)|해설그만|건너뛰어|그만해")) {
            return ActionCode.STOP_SPEAKING;
        }
        if (find(c, "요약") && find(c, "들려|읽어|틀어|해줘|보여|말해|재생|요약해")) {
            return ActionCode.PLAY_SUMMARY;
        }
        if (find(c, "다시(?:말|읽|들려)|한번더(?:말|읽|들려)|못들었|^(?:방금)?뭐라고(?:했|그랬)(?:어|지|나요|어요|니)?$")) {
            return ActionCode.REPEAT_LAST;
        }
        if (find(c, "이동취소|되돌려|원래(?:보던|있던)?(?:데|곳|위치|자리)로|아까(?:보던|그|있던)?(?:데|곳|위치|자리|거기)로|이전위치로")) {
            return ActionCode.UNDO_SEEK;
        }
        if (find(c, "다음(?:장면|챕터|목차)")) {
            return ActionCode.NEXT_SCENE;
        }
        if (find(c, "(?:이전|앞|지난)(?:장면|챕터|목차)")) {
            return ActionCode.PREV_SCENE;
        }
        if (find(c, "지금몇분|몇분(?:쯤|째)?(?:이야|야|이에요|인데|왔|됐)|어디까지(?:봤|왔)|^(?:지금)?어디(?:쯤)?(?:이야|야|에요|예요|인가요|지)?$|얼마나남았|남은시간|몇분남았")) {
            return ActionCode.CURRENT_POSITION;
        }
        if (find(c, "(?:화면|영상)?(?:글자|글씨|텍스트)(?:를|좀)?(?:자세히|다|전부)?읽")) {
            return ActionCode.READ_DETAIL;
        }
        if (find(c, "튜토리얼|사용법(?:을)?다시|처음설명다시")) {
            return ActionCode.REPLAY_TUTORIAL;
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
        if (find(c, "고대비")) {
            return ClassifiedIntent.setting("highContrast", find(c, "꺼|끄|해제|없애") ? "false" : "true");
        }
        if (find(c, "대사만|해설(?:은|을|좀)?(?:꺼|끄|빼|없이|안들)")) {
            return ClassifiedIntent.setting("soundMix", "DIALOGUE_ONLY");
        }
        if (find(c, "해설(?:을|좀|다시)?(?:켜|넣|같이)")) {
            return ClassifiedIntent.setting("soundMix", "DIALOGUE_AND_NARRATION");
        }
        if (find(c, "자막")) {
            if (find(c, "꺼|끄|읽지마|안읽|그만")) {
                return ClassifiedIntent.setting("subtitleReading", "OFF");
            }
            if (find(c, "자막(?:을|은)?(?:다|모두|전부)")) {
                return ClassifiedIntent.setting("subtitleReading", "ALL");
            }
            if (find(c, "(?:다른|번역|외국어)자막만|다를때만")) {
                return ClassifiedIntent.setting("subtitleReading", "DIFFERENT_ONLY");
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
            Matcher n = Pattern.compile("(?:소리|볼륨|음량)(?:를|을)?(\\d{1,3})").matcher(c);
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
        Matcher times = Pattern.compile("(\\d(?:\\.\\d)?)배(?:속)?").matcher(c);
        if (times.find() && find(c, "속도|배속|말|읽")) {
            double rate = Math.max(0.5, Math.min(2.5, Double.parseDouble(times.group(1))));
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
        String query = m.group(1).strip().replaceFirst("^(?:아까|그|저|그때)\\s+", "");
        return query.isEmpty() || VAGUE_SCENES.contains(query) ? null : ClassifiedIntent.seekScene(query);
    }

    private static boolean find(String c, String regex) {
        return Pattern.compile(regex).matcher(c).find();
    }
}
