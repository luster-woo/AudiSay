package com.audisay.domain.auth.dto.request;

/**
 * 비밀번호 규칙. 회원가입과 비밀번호 변경이 함께 쓴다.
 */
public final class PasswordPolicy {
    /** 8~20자, 영문·숫자·특수문자를 각각 하나 이상 포함, 공백 없음 */
    public static final String REGEX = "^(?=.*[A-Za-z])(?=.*\\d)(?=.*[^A-Za-z0-9\\s])\\S{8,20}$";
    public static final String MESSAGE = "비밀번호는 8~20자로, 영문·숫자·특수문자를 모두 넣고 띄어쓰기 없이 써 주세요.";

    private PasswordPolicy() {
    }
}
