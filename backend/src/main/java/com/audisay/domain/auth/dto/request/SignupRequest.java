package com.audisay.domain.auth.dto.request;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record SignupRequest(
        @NotBlank(message = "이메일을 입력해 주세요.")
        @Email(message = "이메일 형식이 올바르지 않아요.")
        @Size(max = 255, message = "이메일은 255자 이하여야 해요.")
        String email,

        @NotBlank(message = "비밀번호를 입력해 주세요.")
        @Pattern(regexp = PasswordPolicy.REGEX, message = PasswordPolicy.MESSAGE)
        String password,

        @NotBlank(message = "이름을 입력해 주세요.")
        @Size(max = 50, message = "이름은 50자 이하여야 해요.")
        String name,

        @NotNull(message = "이용약관과 개인정보 처리에 동의해야 가입할 수 있어요.")
        @AssertTrue(message = "이용약관과 개인정보 처리에 동의해야 가입할 수 있어요.")
        Boolean termsAgreed
) {
}
