package com.audisay.domain.admin.repository;

import java.math.BigDecimal;

/**
 * ai_call_logs 묶음 집계. 크레딧은 모델 단가가 있어야 계산할 수 있어 토큰으로 받고 서비스에서 계산한다.
 * presetCredits는 기록할 때 이미 계산된 값(estimated_credits > 0), priced*Tokens는 그렇지 않은 행의 토큰
 */
public interface AiUsageRow {
    String getGroupKey();

    String getModel();

    Long getCalls();

    Long getErrors();

    Long getFallbacks();

    Long getInputTokens();

    Long getOutputTokens();

    BigDecimal getPresetCredits();

    Long getPricedInputTokens();

    Long getPricedOutputTokens();
}
