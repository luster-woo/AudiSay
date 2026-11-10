package com.audisay.domain.chat.screen;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * 화면 다시 보기(audisay.chat.screen): 저장 자료·뒤 내용에 답이 없는 유튜브 질문이면, 질문한 시각 앞 구간을
 * Gemini에 유튜브 주소로 다시 보여 주고 답한다(영상을 내려받지 않음). 모델·구간은 2026-11-10 스파이크(40문항)로 정했다.
 *
 * @param enabled         false면 쓰지 않는다(기본 false, 운영 설정에서 켠다)
 * @param windowSec       질문한 시각 앞 몇 초를 보여 줄지. 길면 비싸고 '지금' 값이 흐려진다(10초로 줄였을 때 타이머 정답률이 올랐다)
 * @param cheapModel      숫자가 필요 없는 질문은 이 모델 하나(질문당 약 3크레딧)
 * @param mainModel       숫자 질문은 cheapModel과 동시에 묻고 숫자가 같으면 이 모델 답
 * @param tieModel        둘의 숫자가 다르거나 개수 질문이면 함께 물어 다수결
 * @param timeout         모델 한 번 시간 제한(응답 p50 2~3초, 드물게 10초)
 * @param maxOutputTokens 답 길이(1~2문장)
 */
@ConfigurationProperties("audisay.chat.screen")
public record ScreenCheckProperties(Boolean enabled, Integer windowSec, String cheapModel, String mainModel,
                                    String tieModel, Duration timeout, Integer maxOutputTokens) {

    public ScreenCheckProperties {
        enabled = enabled != null && enabled;
        windowSec = windowSec == null ? 15 : windowSec;
        cheapModel = cheapModel == null ? "gemini-3.1-flash-lite" : cheapModel;
        mainModel = mainModel == null ? "gemini-3.5-flash" : mainModel;
        tieModel = tieModel == null ? "gemini-3.8-flash" : tieModel;
        timeout = timeout == null ? Duration.ofSeconds(8) : timeout;
        maxOutputTokens = maxOutputTokens == null ? 200 : maxOutputTokens;
    }

    /** 가장 오래 걸리는 경우: 두 모델 → 셋째 모델(차례로 두 번) */
    public Duration maxDuration() {
        return timeout.multipliedBy(2);
    }
}
