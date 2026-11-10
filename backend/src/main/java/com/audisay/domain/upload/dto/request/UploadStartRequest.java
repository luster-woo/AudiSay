package com.audisay.domain.upload.dto.request;

import com.audisay.domain.video.entity.Visibility;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

/**
 * 형식·용량·길이·저작권 동의는 서비스에서 확인해 업로드 전용 에러 코드로 거절한다.
 *
 * @param durationSec     FE가 브라우저에서 읽은 영상 길이. 워커가 ffprobe로 다시 확인한다
 * @param visibility      비우면 PRIVATE
 * @param copyrightAgreed true만 허용
 */
public record UploadStartRequest(
        @NotBlank(message = "영상 제목을 입력해 주세요.")
        @Size(max = 300, message = "영상 제목은 300자 이하여야 해요.")
        String title,

        @NotBlank(message = "파일 이름을 입력해 주세요.")
        @Size(max = 255, message = "파일 이름은 255자 이하여야 해요.")
        String originalFilename,

        @NotBlank(message = "파일 형식을 입력해 주세요.")
        String contentType,

        @NotNull(message = "파일 크기를 입력해 주세요.")
        @Positive(message = "파일 크기는 0보다 커야 해요.")
        Long sizeBytes,

        @NotNull(message = "영상 길이를 입력해 주세요.")
        @Positive(message = "영상 길이는 0보다 커야 해요.")
        Integer durationSec,

        Visibility visibility,

        Boolean copyrightAgreed
) {
}
