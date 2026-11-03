package com.audisay.domain.chat.tuning;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 챗봇 분류·장면 찾기 단계별 켜고 끄기(기본 모두 켬). 평가(285)에서 "규칙 있음/없음"처럼 하나씩 끄고 정확도·LLM 호출 수·지연을 비교하려고 둔다
 *
 * @param intentRules        발화 분류 규칙(끄면 모두 LLM)
 * @param seekKeyword        장면 찾기 키워드 검색(끄면 모두 LLM 선택)
 * @param seekNegationFilter 키워드 후보에서 부정 문장 빼기·요약하는 말 점수 낮추기
 * @param seekEvidenceBonus  15초 안에 여러 자료가 같이 말한 후보 점수 올리기
 * @param seekLlmVerify      대사 한 줄에서만 찾은 후보가 섞이면 LLM이 거르기
 */
@ConfigurationProperties("audisay.chat.tuning")
public record ChatTuningProperties(Boolean intentRules, Boolean seekKeyword, Boolean seekNegationFilter,
                                   Boolean seekEvidenceBonus, Boolean seekLlmVerify) {

    public static final ChatTuningProperties DEFAULT = new ChatTuningProperties(null, null, null, null, null);

    public ChatTuningProperties {
        intentRules = intentRules == null || intentRules;
        seekKeyword = seekKeyword == null || seekKeyword;
        seekNegationFilter = seekNegationFilter == null || seekNegationFilter;
        seekEvidenceBonus = seekEvidenceBonus == null || seekEvidenceBonus;
        seekLlmVerify = seekLlmVerify == null || seekLlmVerify;
    }
}
