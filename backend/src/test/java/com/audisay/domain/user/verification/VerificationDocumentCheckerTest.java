package com.audisay.domain.user.verification;

import com.audisay.global.aicall.AiCallLog;
import com.audisay.global.aicall.AiCallPurpose;
import com.audisay.global.aicall.AiCallRecorder;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import com.audisay.global.external.ocr.OcrEngine;
import com.audisay.global.external.ocr.OcrException;
import com.audisay.global.external.ocr.OcrLine;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockMultipartFile;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class VerificationDocumentCheckerTest {
    private static final Long USER_ID = 2L;

    private VerificationAttemptLimiter limiter;
    private OcrEngine ocrEngine;
    private AiCallRecorder recorder;
    private SimpleMeterRegistry meterRegistry;
    private VerificationDocumentChecker checker;

    @BeforeEach
    void setUp() {
        limiter = mock(VerificationAttemptLimiter.class);
        ocrEngine = mock(OcrEngine.class);
        recorder = mock(AiCallRecorder.class);
        meterRegistry = new SimpleMeterRegistry();
        checker = new VerificationDocumentChecker(limiter, ocrEngine, recorder, meterRegistry);
    }

    @Test
    void 시각장애_서류면_통과하고_기록은_이유_없이() throws IOException {
        when(ocrEngine.read(any())).thenReturn(lines("장애인등록증", "홍길동", "시각/장애의 정도가 심한 장애인"));

        assertThatCode(() -> checker.check(USER_ID, png())).doesNotThrowAnyException();

        AiCallLog log = recorded();
        assertThat(log.getPurpose()).isEqualTo(AiCallPurpose.VERIFY);
        assertThat(log.getModel()).isEqualTo("paddleocr-onnx");
        assertThat(log.getErrorCode()).isNull();
        assertThat(meterRegistry.counter("audisay.verification.verdict", "result", "ACCEPTED").count()).isEqualTo(1);
    }

    @Test
    void 시각이_없으면_USER_006과_이유별_문구() throws IOException {
        when(ocrEngine.read(any())).thenReturn(lines("장애인등록증", "홍길동", "지체/장애의 정도가 심한 장애인"));
        MockMultipartFile file = png();

        assertThatThrownBy(() -> checker.check(USER_ID, file))
                .isInstanceOf(BusinessException.class)
                .hasMessage(DocumentVerdict.NOT_VISUAL.message())
                .extracting("errorCode").isEqualTo(ErrorCode.VERIFICATION_DOCUMENT_REJECTED);
        assertThat(recorded().getErrorCode()).isEqualTo("NOT_VISUAL");
    }

    @Test
    void OCR이_우리_쪽_문제로_실패하면_확인_없이_승인() throws IOException {
        when(ocrEngine.read(any())).thenThrow(new OcrException(OcrException.Kind.ENGINE, "모델 없음"));

        assertThatCode(() -> checker.check(USER_ID, png())).doesNotThrowAnyException();
        assertThat(recorded().getErrorCode()).isEqualTo("OCR_ENGINE");
    }

    @Test
    void 이미지로_못_읽는_파일은_다시_찍기_안내() {
        MockMultipartFile broken = new MockMultipartFile("document", "a.png", "image/png", new byte[]{1, 2, 3});

        assertThatThrownBy(() -> checker.check(USER_ID, broken))
                .isInstanceOf(BusinessException.class)
                .hasMessage(DocumentVerdict.UNREADABLE.message());
        verify(ocrEngine, never()).read(any());
    }

    @Test
    void 하루_시도를_넘으면_OCR을_돌리지_않는다() throws IOException {
        doThrow(new BusinessException(ErrorCode.VERIFICATION_ATTEMPT_LIMIT)).when(limiter).acquire(USER_ID);
        MockMultipartFile file = png();

        assertThatThrownBy(() -> checker.check(USER_ID, file))
                .extracting("errorCode").isEqualTo(ErrorCode.VERIFICATION_ATTEMPT_LIMIT);
        verify(ocrEngine, never()).read(any());
        verify(recorder, never()).record(any());
    }

    private AiCallLog recorded() {
        ArgumentCaptor<AiCallLog> captor = ArgumentCaptor.forClass(AiCallLog.class);
        verify(recorder).record(captor.capture());
        return captor.getValue();
    }

    private static List<OcrLine> lines(String... texts) {
        return java.util.Arrays.stream(texts).map(t -> new OcrLine(t, 0.99)).toList();
    }

    private static MockMultipartFile png() throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(8, 8, BufferedImage.TYPE_INT_RGB), "png", out);
        return new MockMultipartFile("document", "card.png", "image/png", out.toByteArray());
    }
}
