package com.audisay.domain.user.verification;

import com.audisay.global.external.ocr.OcrLine;

import java.util.List;
import java.util.stream.Collectors;

/**
 * OCR 글자로 시각장애인 인증 서류인지 판정한다. 띄어쓰기는 OCR마다 달라서 빼고 비교한다.
 * 통과: 서류 종류(장애인등록증·복지카드·장애인증명서) + "시각", 단 "소득세법"이 있으면 병원 발급 세금 공제용 서식이라 거절.
 */
public final class VerificationDocumentJudge {
    /** 이보다 적게 읽혔으면 흐리거나 글자가 없는 사진으로 본다 */
    static final int MIN_CHARS = 10;
    private static final List<String> KINDS = List.of("장애인등록증", "복지카드", "장애인증명서");
    private static final String VISUAL = "시각";
    private static final String TAX_LAW = "소득세법";

    private VerificationDocumentJudge() {
    }

    public static DocumentVerdict judge(List<OcrLine> lines) {
        String text = lines.stream().map(OcrLine::text).collect(Collectors.joining()).replaceAll("\\s+", "");
        if (text.length() < MIN_CHARS) {
            return DocumentVerdict.UNREADABLE;
        }
        if (text.contains(TAX_LAW)) {
            return DocumentVerdict.TAX_FORM;
        }
        if (KINDS.stream().noneMatch(text::contains)) {
            return DocumentVerdict.NOT_PROOF;
        }
        if (!text.contains(VISUAL)) {
            return DocumentVerdict.NOT_VISUAL;
        }
        return DocumentVerdict.ACCEPTED;
    }
}
