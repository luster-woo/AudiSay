package com.audisay.domain.upload.dto.request;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

import java.util.List;

/**
 * @param parts 올린 조각 전부. 조각마다 S3 PUT 응답 헤더의 ETag
 */
public record UploadCompleteRequest(
        @NotEmpty(message = "올린 조각 정보를 입력해 주세요.")
        List<@NotNull(message = "올린 조각 정보를 입력해 주세요.") @Valid Part> parts
) {
    public record Part(
            @NotNull(message = "조각 번호를 입력해 주세요.")
            @Positive(message = "조각 번호는 1부터예요.")
            Integer partNumber,

            @JsonProperty("eTag")
            @NotBlank(message = "조각의 ETag를 입력해 주세요.")
            String eTag
    ) {
    }
}
