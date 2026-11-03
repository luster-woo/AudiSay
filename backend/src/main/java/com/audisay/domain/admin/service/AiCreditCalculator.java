package com.audisay.domain.admin.service;

import com.audisay.domain.admin.repository.AiUsageRow;
import com.audisay.global.external.llm.GmsProperties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 조회 시점 크레딧 = 기록 때 계산된 값(estimated_credits) + 나머지 행의 토큰 × 모델 단가(audisay.gms.prices).
 * 워커는 estimated_credits를 0으로 남기므로 대부분 토큰으로 계산된다
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AiCreditCalculator {
    private final GmsProperties gmsProperties;
    private final Set<String> warnedModels = ConcurrentHashMap.newKeySet();

    public BigDecimal credits(AiUsageRow row) {
        return orZero(row.getPresetCredits())
                .add(tokenCredits(row.getModel(), orZero(row.getPricedInputTokens()), orZero(row.getPricedOutputTokens())));
    }

    BigDecimal tokenCredits(String model, long inputTokens, long outputTokens) {
        if (inputTokens == 0 && outputTokens == 0) {
            return BigDecimal.ZERO;
        }
        GmsProperties.Price price = gmsProperties.prices().get(model);
        if (price == null) {
            if (!isFree(model) && warnedModels.add(model)) {
                log.warn("단가표에 없는 모델이라 크레딧을 0으로 셉니다: {}", model);
            }
            return BigDecimal.ZERO;
        }
        return price.input().multiply(BigDecimal.valueOf(inputTokens))
                .add(price.output().multiply(BigDecimal.valueOf(outputTokens)));
    }

    private static boolean isFree(String model) {
        return model == null || model.startsWith("h200:") || model.startsWith("supertonic");
    }

    private static BigDecimal orZero(BigDecimal value) {
        return value == null ? BigDecimal.ZERO : value;
    }

    private static long orZero(Long value) {
        return value == null ? 0 : value;
    }
}
