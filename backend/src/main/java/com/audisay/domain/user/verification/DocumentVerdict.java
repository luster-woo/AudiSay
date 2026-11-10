package com.audisay.domain.user.verification;

/** 인증 서류 판정. ACCEPTED가 아니면 USER_006(422)과 함께 message를 안내한다 */
public enum DocumentVerdict {
    ACCEPTED(null),
    UNREADABLE("서류의 글자를 읽지 못했어요. 글자가 잘 보이게 밝은 곳에서 다시 찍어 주세요."),
    TAX_FORM("세금 공제용 장애인증명서는 쓸 수 없어요. 정부24나 주민센터에서 발급한 장애인증명서를 올려 주세요."),
    NOT_PROOF("복지카드(장애인등록증)나 장애인증명서가 아니에요. 서류 이름이 보이게 올려 주세요."),
    NOT_VISUAL("서류에서 시각장애를 확인하지 못했어요. 장애 유형이 보이게 다시 올려 주세요.");

    private final String message;

    DocumentVerdict(String message) {
        this.message = message;
    }

    public String message() {
        return message;
    }
}
