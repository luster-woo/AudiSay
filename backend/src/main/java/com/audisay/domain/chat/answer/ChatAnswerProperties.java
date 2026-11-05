package com.audisay.domain.chat.answer;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * @param threads            동시에 만들 수 있는 답변 수(넘으면 CHAT_005)
 * @param ttsThreads         답변 문장 음성(AI /internal/tts)을 만드는 스레드 수
 * @param voice              답변 목소리(Supertonic, 안내 목소리와 같음)
 * @param streamTimeout      SSE 연결 최대 시간(LLM 전체 60초 + 음성)
 * @param speechWait         LLM이 끝난 뒤 남은 문장 음성을 기다리는 최대 시간
 * @param futureCheckTimeout 뒤 내용 확인 LLM이 걸릴 수 있는 최대 시간(audisay.gms.timeouts.answer와 같게).
 *                           SSE에 이 시간 + speechWait가 남지 않으면 확인을 건너뛴다
 */
@ConfigurationProperties("audisay.chat.answer")
public record ChatAnswerProperties(Integer threads, Integer ttsThreads, String voice, Duration streamTimeout,
                                   Duration speechWait, Duration futureCheckTimeout) {

    public ChatAnswerProperties {
        threads = threads == null ? 32 : threads;
        ttsThreads = ttsThreads == null ? 16 : ttsThreads;
        voice = voice == null ? "F1" : voice;
        streamTimeout = streamTimeout == null ? Duration.ofSeconds(90) : streamTimeout;
        speechWait = speechWait == null ? Duration.ofSeconds(15) : speechWait;
        futureCheckTimeout = futureCheckTimeout == null ? Duration.ofSeconds(60) : futureCheckTimeout;
    }
}
