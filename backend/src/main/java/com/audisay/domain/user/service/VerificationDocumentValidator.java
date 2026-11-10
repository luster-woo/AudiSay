package com.audisay.domain.user.service;

import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import org.springframework.stereotype.Component;
import org.springframework.util.unit.DataSize;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;
import java.util.List;

/**
 * 인증 서류 검사. 파일 앞부분(시그니처)만 메모리로 읽고, 내용은 저장하거나 로그에 남기지 않는다.
 */
@Component
public class VerificationDocumentValidator {
    private static final long MAX_SIZE_BYTES = DataSize.ofMegabytes(10).toBytes();
    private static final String TYPE_MESSAGE = "인증 서류는 PDF, JPG, PNG 파일만 올릴 수 있어요.";
    private static final String SIZE_MESSAGE = "인증 서류는 10MB 이하만 올릴 수 있어요.";

    private static final List<FileType> ALLOWED_TYPES = List.of(
            new FileType("application/pdf", new byte[]{0x25, 0x50, 0x44, 0x46}),                         // %PDF
            new FileType("image/jpeg", new byte[]{(byte) 0xFF, (byte) 0xD8, (byte) 0xFF}),
            new FileType("image/png", new byte[]{(byte) 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A})
    );

    public void validate(MultipartFile document) {
        if (document == null || document.isEmpty()) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "인증 서류를 첨부해 주세요.");
        }
        if (document.getSize() > MAX_SIZE_BYTES) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, SIZE_MESSAGE);
        }
        FileType type = ALLOWED_TYPES.stream()
                .filter(allowed -> allowed.contentType().equalsIgnoreCase(document.getContentType()))
                .findFirst()
                .orElseThrow(() -> new BusinessException(ErrorCode.INVALID_INPUT, TYPE_MESSAGE));
        // 확장자·Content-Type만 바꾼 다른 파일을 거른다
        if (!type.matches(readHeader(document, type.signature().length))) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, TYPE_MESSAGE);
        }
    }

    private byte[] readHeader(MultipartFile document, int length) {
        try (InputStream in = document.getInputStream()) {
            return in.readNBytes(length);
        } catch (IOException e) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, TYPE_MESSAGE);
        }
    }

    private record FileType(String contentType, byte[] signature) {
        boolean matches(byte[] header) {
            return Arrays.equals(signature, header);
        }
    }
}
