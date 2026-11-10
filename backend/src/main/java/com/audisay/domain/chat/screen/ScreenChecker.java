package com.audisay.domain.chat.screen;

import com.audisay.domain.chat.screen.ScreenAnswerJudge.Kind;
import com.audisay.domain.chat.screen.ScreenAnswerJudge.Verdict;
import com.audisay.domain.video.entity.SourceType;
import com.audisay.domain.video.repository.VideoRepository;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.time.Duration;
import java.util.Arrays;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Function;

/**
 * 화면 다시 보기: 저장 자료로 답하지 못한 유튜브 질문에, 질문한 시각 앞 {@code windowSec}초를 Gemini에 다시 보여 주고 답한다.
 * 질문 종류에 따라 싼 경로부터(2026-11-10 스파이크 40문항, 틀린 숫자 0건 · 평균 18~27크레딧):
 * <ul>
 *   <li>GENERAL(색·옷·누구): 싼 모델 하나. 답에 숫자가 섞이면 주 모델로 확인</li>
 *   <li>NUMERIC(몇·얼마·점수·시간): 싼·주 모델을 동시에, 숫자가 같으면 주 모델 답, 다르면 셋째 모델로 다수결</li>
 *   <li>COUNT(몇 명·몇 개): 세 모델을 동시에, 범위로("보이는 것만 세면 2~4명 정도")</li>
 * </ul>
 * 지표 audisay.chat.screen{kind, result: answered / unsure(모른다고 답함) / failed(모두 실패)}
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ScreenChecker {
    /** 화면을 보러 가기 전에 먼저 읽는 말(다시 보기는 2~5초 걸린다) */
    public static final String CHECKING = "화면을 확인해 볼게요.";
    /** 모든 모델이 실패했을 때(429·시간 초과) */
    public static final String FAILED = "지금은 화면을 확인하지 못했어요.";
    static final String SYSTEM = """
            당신은 시각장애인 이용자의 질문에, 주어진 유튜브 영상 구간의 화면과 소리를 보고 답하는 도우미입니다.
            - 이용자가 질문한 순간은 구간의 마지막입니다. "지금" 점수·숫자·상태는 구간 마지막 화면 기준으로 답합니다.
            - 구간에서 실제로 보이거나 들리는 것만으로 답합니다. 짐작하거나 지어내지 않습니다.
            - 숫자·이름·글자는 화면에 보이는 그대로 씁니다. 작아서 확실히 읽히지 않으면 숫자를 만들지 말고 "화면에서 확인할 수 없어요"라고 답합니다.
            - 사람·캐릭터 이름은 화면 글자(자막·이름표)나 대사에 나온 것만 씁니다. 얼굴이나 생김새로 짐작한 이름은 쓰지 않고, 근거가 없으면 "화면에서 확인할 수 없어요"라고 답합니다.
            - 개수를 물으면 화면에 보이는 것만 세어 숫자로 답합니다.
            - 물건(메모지·간판·포장·옷)에 적힌 글자를 물으면 그 물건의 글자만 읽습니다. 영상 편집으로 넣은 자막은 물건의 글자가 아니니 옮기지 않고, 물건의 글자가 읽히지 않으면 "화면에서 확인할 수 없어요"라고 답합니다.
            - 아직 일어나지 않은 일(다음·마지막·결과·~할까)을 물으면 짐작하지 말고 "화면에서 확인할 수 없어요"라고 답합니다.
            - 영상 재생 시각(00:00)이나 "영상에서", "구간" 같은 말은 쓰지 않습니다.
            - 한국어 해요체 1~2문장, 120자 이내로 답합니다.""";
    private static final String WATCH_URL = "https://www.youtube.com/watch?v=";

    private final ScreenCheckProperties properties;
    private final ScreenVideoClient client;
    private final VideoRepository videoRepository;
    private final MeterRegistry meterRegistry;
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();

    /** 켜졌는지 시작할 때 한 번 남긴다(설정·환경 변수 AUDISAY_CHAT_SCREEN_ENABLED가 먹었는지 확인용) */
    @PostConstruct
    void logSettings() {
        log.info("[SCREEN] 화면 다시 보기 enabled={} 구간={}초 모델={}/{}/{} 시간 제한={}", properties.enabled(),
                properties.windowSec(), properties.cheapModel(), properties.mainModel(), properties.tieModel(),
                properties.timeout());
    }

    @PreDestroy
    void shutdown() {
        executor.shutdownNow();
    }

    /** 가장 오래 걸리는 경우(두 모델 → 셋째 모델). 호출한 쪽은 SSE에 이만큼 남았을 때만 부른다 */
    public Duration maxDuration() {
        return properties.maxDuration();
    }

    /** 켜져 있고 유튜브 영상이면 Gemini에 보여 줄 주소. 직접 올린 영상은 없다(파일을 보내야 해서 아직 안 함) */
    public Optional<String> youtubeUrl(Long videoId) {
        if (!properties.enabled() || videoId == null) {
            return Optional.empty();
        }
        return videoRepository.findById(videoId)
                .filter(video -> video.getSourceType() == SourceType.YOUTUBE
                        && StringUtils.hasText(video.getYoutubeVideoId()))
                .map(video -> WATCH_URL + video.getYoutubeVideoId());
    }

    /**
     * 질문한 시각 앞 구간을 보고 답한다. 구간 끝은 질문한 시각(뒤 내용이 섞이지 않게)
     *
     * @return 모든 모델이 실패했으면 empty. 모른다고 답했으면 answered=false
     */
    public Optional<Verdict> check(String youtubeUrl, int nowMs, String question, Long chatLogId) {
        int end = Math.max(1, nowMs / 1000);
        int start = Math.max(0, end - properties.windowSec());
        Kind kind = ScreenAnswerJudge.kind(question);
        Function<String, CompletableFuture<String>> ask = model -> CompletableFuture.supplyAsync(() -> {
            ScreenVideoClient.Answer answer = client.ask(model, youtubeUrl, start, end, SYSTEM, question, chatLogId);
            return answer == null || answer.text().isBlank() ? null : answer.text();
        }, executor);
        Verdict verdict = switch (kind) {
            case GENERAL -> general(ask);
            case NUMERIC -> decide(ask, ask.apply(properties.mainModel()), ask.apply(properties.cheapModel()));
            case COUNT -> count(ask, question);
        };
        String result = verdict == null ? "failed" : verdict.answered() ? "answered" : "unsure";
        meterRegistry.counter("audisay.chat.screen", "kind", kind.name(), "result", result).increment();
        log.info("[SCREEN] chatLogId={} kind={} 구간={}~{}초 result={} 이유={}", chatLogId, kind, start, end, result,
                verdict == null ? null : verdict.reason());
        return Optional.ofNullable(verdict);
    }

    /** 싼 모델 하나. 숫자가 섞였거나 실패했으면 주 모델과 맞춰 본다 */
    private Verdict general(Function<String, CompletableFuture<String>> ask) {
        String cheap = join(ask.apply(properties.cheapModel()));
        if (ScreenAnswerJudge.settledWithoutNumbers(cheap)) {
            return ScreenAnswerJudge.single(cheap);
        }
        return decide(ask, ask.apply(properties.mainModel()), CompletableFuture.completedFuture(cheap));
    }

    /** 주·싼 모델 답을 맞춰 보고, 정하지 못하면 셋째 모델로 다수결 */
    private Verdict decide(Function<String, CompletableFuture<String>> ask, CompletableFuture<String> mainCall,
                           CompletableFuture<String> cheapCall) {
        String main = join(mainCall);
        String cheap = join(cheapCall);
        if (main == null && cheap == null) {
            return null;
        }
        if (cheap == null && ScreenAnswerJudge.settledWithoutNumbers(main)) {
            return ScreenAnswerJudge.single(main);
        }
        Verdict pair = ScreenAnswerJudge.pair(main, cheap);
        if (pair != null) {
            return pair;
        }
        String tie = join(ask.apply(properties.tieModel()));
        return ScreenAnswerJudge.vote(Arrays.asList(main, cheap, tie));
    }

    /** 세 모델을 동시에. 가려진 것을 같이 빼고 세는 일이 있어 범위로 말한다 */
    private Verdict count(Function<String, CompletableFuture<String>> ask, String question) {
        CompletableFuture<String> main = ask.apply(properties.mainModel());
        CompletableFuture<String> cheap = ask.apply(properties.cheapModel());
        CompletableFuture<String> tie = ask.apply(properties.tieModel());
        return ScreenAnswerJudge.count(Arrays.asList(join(main), join(cheap), join(tie)), question);
    }

    private static String join(CompletableFuture<String> call) {
        try {
            return call.join();
        } catch (RuntimeException e) {
            log.warn("[SCREEN] 화면 다시 보기 호출 실패: {}", e.getMessage());
            return null;
        }
    }
}
