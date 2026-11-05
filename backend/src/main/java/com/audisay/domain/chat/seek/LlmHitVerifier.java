package com.audisay.domain.chat.seek;

import com.audisay.domain.chat.seek.KeywordSceneScorer.Hit;
import com.audisay.domain.chat.tuning.ChatTuningProperties;
import com.audisay.domain.description.service.SceneText.Moment;
import com.audisay.domain.description.service.SceneText.MomentType;
import com.audisay.global.external.llm.LlmClient;
import com.audisay.global.external.llm.LlmException;
import com.audisay.global.external.llm.LlmPurpose;
import com.audisay.global.external.llm.LlmRequest;
import com.audisay.global.external.llm.LlmResult;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.util.Comparator;
import java.util.List;
import java.util.stream.Collectors;

/**
 * 키워드 후보가 여럿이고 대사 한 줄에서만 찾은 후보가 섞였을 때, 후보마다 앞뒤 문장을 붙여 LLM이 "그 순간에 실제로 그 일이 일어났는지" 거른다.
 * "오늘 안타가 하나도 없네요"(규칙이 놓친 부정)·"지금까지 안타 3개째"(요약) 같은 말을 뺀다. 거르기는 덤이라 LLM이 실패해도 후보를 그대로 둔다.
 * 검색어 낱말을 다 못 맞힌 후보(seek-partial-verify)도 여기서 확인한다. seek-exact-only면 비슷한 다른 일도 뺀다
 */
@Slf4j
@Component
public class LlmHitVerifier {
    static final int CONTEXT_MS = 10_000;
    static final int CONTEXT_CHARS = 80;
    static final int MAX_CANDIDATES = 40;
    static final int MAX_OUTPUT_TOKENS = 150;
    static final String SYSTEM = """
            시각장애인이 영상에서 찾는 장면의 후보입니다. 후보마다 시각, 찾은 문장, 앞뒤 문장이 있습니다.
            - 그 순간에 요청한 일이 실제로 일어난 후보 번호만 고르세요.
            - 일어나지 않았다는 말("안타가 하나도 없네요", "못 쳤어요"), 지난 일을 요약하거나 개수를 세는 말("지금까지 안타 3개"), 앞으로 일어날지 말하는 말은 빼세요.
            - 설명 없이 JSON 한 줄만 답하세요: {"ok": [번호, ...]} 하나도 없으면 {"ok": []}""";
    static final String SYSTEM_EXACT = """
            시각장애인이 영상에서 찾는 장면의 후보입니다. 후보마다 시각, 찾은 문장, 앞뒤 문장이 있습니다.
            - 그 순간에 요청한 일이 실제로 일어난 후보 번호만 고르세요.
            - 일어나지 않았다는 말("안타가 하나도 없네요", "못 쳤어요"), 지난 일을 요약하거나 개수를 세는 말("지금까지 안타 3개"), 앞으로 일어날지 말하는 말은 빼세요.
            - 낱말 일부만 같고 다른 일이면 빼세요(예: "골 넣는 장면"을 찾는데 "슛이 골대를 맞고 나옴", "춤추는 장면"을 찾는데 "춤 연습실 간판").
            - 설명 없이 JSON 한 줄만 답하세요: {"ok": [번호, ...]} 하나도 없으면 {"ok": []}""";

    private final LlmClient llmClient;
    private final ObjectMapper objectMapper;
    private final boolean exactOnly;

    public LlmHitVerifier(LlmClient llmClient, ObjectMapper objectMapper) {
        this(llmClient, objectMapper, ChatTuningProperties.DEFAULT);
    }

    @Autowired
    public LlmHitVerifier(LlmClient llmClient, ObjectMapper objectMapper, ChatTuningProperties tuning) {
        this.llmClient = llmClient;
        this.objectMapper = objectMapper;
        this.exactOnly = tuning.seekExactOnly();
    }

    /** 대사 한 줄에서만 찾은 후보가 있으면 거를 만하다(해설 문장·화면 글자가 같이 말한 후보는 믿을 만함) */
    public static boolean worthVerifying(List<Hit> hits) {
        return hits.size() >= 2 && hits.size() <= MAX_CANDIDATES && hits.stream().anyMatch(h -> h.evidence() == 1
                && h.moment() != null && h.moment().type() == MomentType.DIALOGUE);
    }

    /** @return 실제로 일어난 후보만(순서 유지). LLM 실패·읽을 수 없는 응답이면 받은 그대로 */
    public List<Hit> verify(String query, List<Hit> hits, Long chatLogId) {
        return verify(query, hits, chatLogId, null);
    }

    /** @param deadlineNanos 응답 시간 예산. 주 모델이 실패했을 때 대체 모델을 기다릴 시간이 없으면 부르지 않는다 */
    public List<Hit> verify(String query, List<Hit> hits, Long chatLogId, Long deadlineNanos) {
        List<Hit> checked = check(query, hits, chatLogId, deadlineNanos);
        return checked == null ? hits : checked;
    }

    /** verify와 같지만 LLM이 실패하거나 응답을 읽을 수 없으면 null(호출한 쪽이 정한다. RAG는 1등 후보 하나만) */
    public List<Hit> check(String query, List<Hit> hits, Long chatLogId, Long deadlineNanos) {
        StringBuilder user = new StringBuilder("요청: ").append(query).append("\n\n[후보]\n");
        for (int i = 0; i < hits.size(); i++) {
            user.append(i + 1).append(". ").append(line(hits.get(i))).append('\n');
        }
        LlmResult result;
        try {
            LlmRequest request = LlmRequest.json(LlmPurpose.SEEK, exactOnly ? SYSTEM_EXACT : SYSTEM, user.toString(),
                    MAX_OUTPUT_TOKENS).withChatLogId(chatLogId);
            result = llmClient.generate(request.withFallbackDeadline(deadlineNanos));
        } catch (LlmException e) {
            log.warn("장면 후보 확인을 건너뜁니다({}): {}", e.getKind(), e.getMessage());
            return null;
        }
        List<Integer> ok = LlmNumbers.parse(objectMapper, result.text(), "ok", hits.size());
        if (ok == null) {
            return null;
        }
        return hits.stream().filter(h -> ok.contains(hits.indexOf(h) + 1)).toList();
    }

    /** "1:33 대사 "쳤습니다! 중견수 앞 안타!" (앞: … / 뒤: …)" */
    static String line(Hit hit) {
        StringBuilder line = new StringBuilder(SceneToc.clock(hit.targetMs())).append(' ');
        Moment moment = hit.moment();
        if (moment == null) {
            return line.append("목차 \"").append(hit.scene().title()).append(" / ").append(hit.snippet()).append('"').toString();
        }
        line.append(label(moment.type())).append(" \"").append(moment.text()).append('"');
        List<Moment> around = hit.scene().moments().stream()
                .filter(m -> m != moment && Math.abs(m.startMs() - moment.startMs()) <= CONTEXT_MS)
                .sorted(Comparator.comparingInt(Moment::startMs))
                .toList();
        String before = join(around.stream().filter(m -> m.startMs() <= moment.startMs()).toList());
        String after = join(around.stream().filter(m -> m.startMs() > moment.startMs()).toList());
        if (!before.isEmpty() || !after.isEmpty()) {
            line.append(" (앞: ").append(before.isEmpty() ? "-" : before)
                    .append(" / 뒤: ").append(after.isEmpty() ? "-" : after).append(')');
        }
        return line.toString();
    }

    private static String join(List<Moment> moments) {
        String text = moments.stream().map(Moment::text).collect(Collectors.joining(" "));
        return text.length() <= CONTEXT_CHARS ? text : text.substring(0, CONTEXT_CHARS) + "…";
    }

    private static String label(MomentType type) {
        return switch (type) {
            case NARRATION -> "해설";
            case DIALOGUE -> "대사";
            case SCREEN -> "화면 글자";
        };
    }
}
