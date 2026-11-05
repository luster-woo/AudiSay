package com.audisay.domain.admin.service;

import com.audisay.domain.admin.dto.response.ChatStatsResponse;
import com.audisay.domain.admin.dto.response.ChatStatsResponse.AnswerIntentStat;
import com.audisay.domain.admin.dto.response.ChatStatsResponse.AnswerStat;
import com.audisay.domain.admin.dto.response.ChatStatsResponse.IntentStat;
import com.audisay.domain.admin.dto.response.ChatStatsResponse.SeekStat;
import com.audisay.domain.admin.dto.response.ChatStatsResponse.Unanswered;
import com.audisay.domain.admin.repository.ChatStatsRepository;
import com.audisay.domain.admin.repository.ChatStatsRepository.AnswerRow;
import com.audisay.domain.admin.repository.ChatStatsRepository.LatencyRow;
import com.audisay.domain.admin.repository.ChatStatsRepository.SeekRow;
import com.audisay.domain.chat.answer.AnswerPrompt;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 챗봇 품질 통계: intent별 입력, 답변 근거(바로 답함 / 자료에 없음 / 뒤에 있어 물음 / 골라 들음), 첫 음성 p50·p95, 장면 찾기 방법,
 * 어디에도 답이 없던 최근 질문(해설 보완 후보). "들으시겠어요?"는 따로 저장하지 않아 그때 읽은 안내 문장으로 센다
 */
@Service
@RequiredArgsConstructor
public class AdminChatStatsService {
    static final int UNANSWERED_LIMIT = 20;
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final List<String> ANSWER_INTENTS = List.of("QUESTION", "SCENE_NOW", "RECAP");

    private final ChatStatsRepository repository;

    /** from·to는 KST 날짜, 양끝 포함, 최대 92일 */
    @Transactional(readOnly = true)
    public ChatStatsResponse getChatStats(LocalDate from, LocalDate to) {
        AdminStatsService.validateRange(from, to);
        Instant start = from.atStartOfDay(KST).toInstant();
        Instant end = to.plusDays(1).atStartOfDay(KST).toInstant();

        List<IntentStat> byIntent = repository.countByIntent(start, end).stream()
                .sorted(Comparator.comparingLong(ChatStatsRepository.IntentRow::getCount).reversed())
                .map(r -> new IntentStat(r.getIntent(), r.getCount(), roundMs(r.getP50()), roundMs(r.getP95())))
                .toList();
        long inputs = byIntent.stream().mapToLong(IntentStat::count).sum();

        List<Unanswered> unanswered = repository
                .findUnanswered(start, end, AnswerPrompt.FUTURE_PROMPT, UNANSWERED_LIMIT).stream()
                .map(r -> new Unanswered(r.getChatLogId(), r.getVideoId(), r.getVideoTitle(), r.getVideoTimeMs(),
                        r.getUtterance(), r.getCreatedAt()))
                .toList();
        return new ChatStatsResponse(from, to, inputs, byIntent, answer(start, end), seek(start, end), unanswered);
    }

    private AnswerStat answer(Instant start, Instant end) {
        Map<String, long[]> counts = new LinkedHashMap<>();
        long offered = 0;
        for (AnswerRow row : repository.countAnswers(start, end, AnswerPrompt.FUTURE_PROMPT)) {
            long[] c = counts.computeIfAbsent(row.getIntent(), k -> new long[4]);
            long n = row.getCount();
            c[0] += n;
            switch (row.getAnswerSource()) {
                case "STORED" -> c[1] += n;
                case "UNANSWERABLE" -> {
                    c[2] += n;
                    if ("QUESTION".equals(row.getIntent())) {
                        offered += row.getFutureOffered() == null ? 0 : row.getFutureOffered();
                    }
                }
                case "FUTURE" -> c[3] += n;
                default -> {
                }
            }
        }
        Map<String, LatencyRow> audio = new HashMap<>();
        repository.firstAudioByIntent(start, end).forEach(r -> audio.put(r.getIntent(), r));

        List<AnswerIntentStat> byIntent = new ArrayList<>();
        for (String intent : ANSWER_INTENTS) {
            long[] c = counts.get(intent);
            if (c == null) {
                continue;
            }
            LatencyRow latency = audio.get(intent);
            byIntent.add(new AnswerIntentStat(intent, c[0], c[1], c[2], c[3],
                    latency == null ? null : roundMs(latency.getP50()), latency == null ? null : roundMs(latency.getP95())));
        }
        long[] q = counts.getOrDefault("QUESTION", new long[4]);
        long notDirect = q[2] + q[3];
        long futureOffered = offered + q[3];
        return new AnswerStat(byIntent, q[0], notDirect, futureOffered, q[3], rate(notDirect, q[0]),
                rate(futureOffered, notDirect), rate(q[3], futureOffered));
    }

    private SeekStat seek(Instant start, Instant end) {
        long keyword = 0;
        long llm = 0;
        long rag = 0;
        long notFound = 0;
        for (SeekRow row : repository.countSeekSources(start, end)) {
            if ("KEYWORD".equals(row.getSeekSource())) {
                keyword += row.getCount();
            } else if ("LLM".equals(row.getSeekSource())) {
                llm += row.getCount();
            } else if ("RAG".equals(row.getSeekSource())) {
                rag += row.getCount();
            } else {
                notFound += row.getCount();
            }
        }
        long total = keyword + llm + rag + notFound;
        return new SeekStat(total, keyword, llm, rag, notFound, rate(keyword, total));
    }

    private static Long roundMs(Double ms) {
        return ms == null ? null : Math.round(ms);
    }

    private static double rate(long part, long whole) {
        return whole == 0 ? 0 : (double) part / whole;
    }
}
