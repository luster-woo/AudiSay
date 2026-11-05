package com.audisay.domain.user.verification;

import com.audisay.global.external.ocr.OcrLine;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class VerificationDocumentJudgeTest {

    @Test
    void 복지카드_시각이면_통과() {
        assertThat(judge("장애인등록증", "성명", "홍길동", "시각/장애의 정도가 심한 장애인"))
                .isEqualTo(DocumentVerdict.ACCEPTED);
    }

    @Test
    void 띄어쓰기가_달라도_통과() {
        assertThat(judge("장애인 등록증", "홍길동", "시 각 / 심한 장애인")).isEqualTo(DocumentVerdict.ACCEPTED);
        assertThat(judge("복지카드", "가상은행 체크카드", "시각(심한장애)")).isEqualTo(DocumentVerdict.ACCEPTED);
        assertThat(judge("장 애 인 증 명 서", "장애유형", "시각장애")).isEqualTo(DocumentVerdict.ACCEPTED);
    }

    @Test
    void 다른_장애_유형이면_시각_아님() {
        assertThat(judge("장애인등록증", "홍길동", "지체/장애의 정도가 심하지 않은 장애인"))
                .isEqualTo(DocumentVerdict.NOT_VISUAL);
    }

    @Test
    void 소득세법_서식은_시각이_있어도_거절() {
        assertThat(judge("소득세법 시행규칙 [별지 제38호서식]", "장애인증명서", "양안 시각 장애"))
                .isEqualTo(DocumentVerdict.TAX_FORM);
    }

    @Test
    void 진단서는_시각이_있어도_서류_아님() {
        assertThat(judge("진단서", "병명", "양안 시각 장애, 녹내장", "가상안과의원"))
                .isEqualTo(DocumentVerdict.NOT_PROOF);
    }

    @Test
    void 글자가_거의_없으면_다시_찍기() {
        assertThat(judge("141940", "09")).isEqualTo(DocumentVerdict.UNREADABLE);
        assertThat(VerificationDocumentJudge.judge(List.of())).isEqualTo(DocumentVerdict.UNREADABLE);
    }

    private static DocumentVerdict judge(String... texts) {
        return VerificationDocumentJudge.judge(Arrays.stream(texts).map(t -> new OcrLine(t, 0.99)).toList());
    }
}
