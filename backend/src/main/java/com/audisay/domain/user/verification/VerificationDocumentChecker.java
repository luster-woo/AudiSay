package com.audisay.domain.user.verification;

import com.audisay.global.aicall.AiCallLog;
import com.audisay.global.aicall.AiCallRecorder;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import com.audisay.global.external.ocr.OcrEngine;
import com.audisay.global.external.ocr.OcrException;
import com.audisay.global.external.ocr.OcrImage;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;

/**
 * 형식 검사를 통과한 인증 서류를 OCR로 읽어 판정한다(트랜잭션 밖에서 부른다). 서류·읽은 글자는 메모리에서만 쓰고 저장·로그에 남기지 않는다.
 * 파일을 이미지로 못 읽으면 거절(다시 찍기), OCR이 우리 쪽 문제로 실패하면 확인 없이 승인하고 기록만 남긴다(접근성 우선).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class VerificationDocumentChecker {
    static final String MODEL = "paddleocr-onnx";
    static final String ENGINE_FAILURE = "OCR_ENGINE";

    private final VerificationAttemptLimiter attemptLimiter;
    private final OcrEngine ocrEngine;
    private final AiCallRecorder aiCallRecorder;
    private final MeterRegistry meterRegistry;

    /**
     * @throws BusinessException USER_007 하루 시도 초과, USER_006 확인할 수 없는 서류(판정 이유별 문구)
     */
    public void check(Long userId, MultipartFile document) {
        attemptLimiter.acquire(userId);
        long start = System.nanoTime();
        DocumentVerdict verdict;
        boolean engineFailed = false;
        try {
            OcrImage image = OcrImage.decode(document.getBytes(), document.getContentType());
            verdict = VerificationDocumentJudge.judge(ocrEngine.read(image));
        } catch (IOException e) {
            verdict = DocumentVerdict.UNREADABLE;
        } catch (OcrException e) {
            engineFailed = e.kind() == OcrException.Kind.ENGINE;
            verdict = engineFailed ? DocumentVerdict.ACCEPTED : DocumentVerdict.UNREADABLE;
            if (engineFailed) {
                log.warn("[인증 서류] OCR 실패로 서류 확인 없이 승인 userId={}: {}", userId, e.getMessage());
            }
        } catch (RuntimeException e) {
            engineFailed = true;
            verdict = DocumentVerdict.ACCEPTED;
            log.warn("[인증 서류] OCR 중 예상 못 한 오류로 서류 확인 없이 승인 userId={}", userId, e);
        }
        int latencyMs = (int) ((System.nanoTime() - start) / 1_000_000);
        String code = engineFailed ? ENGINE_FAILURE : verdict == DocumentVerdict.ACCEPTED ? null : verdict.name();
        record(latencyMs, code);
        meterRegistry.counter("audisay.verification.verdict", "result", engineFailed ? ENGINE_FAILURE : verdict.name())
                .increment();
        if (verdict != DocumentVerdict.ACCEPTED) {
            throw new BusinessException(ErrorCode.VERIFICATION_DOCUMENT_REJECTED, verdict.message());
        }
    }

    private void record(int latencyMs, String code) {
        try {
            aiCallRecorder.record(AiCallLog.verify(MODEL, latencyMs, code));
        } catch (RuntimeException e) {
            log.warn("[인증 서류] OCR 호출 기록 실패: {}", e.getMessage());
        }
    }
}
