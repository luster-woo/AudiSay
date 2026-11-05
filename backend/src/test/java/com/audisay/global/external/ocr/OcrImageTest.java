package com.audisay.global.external.ocr;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class OcrImageTest {
    // 가로 3, 세로 2:  1 2 3 / 4 5 6
    private final OcrImage image = new OcrImage(3, 2, new int[]{1, 2, 3, 4, 5, 6});

    @Test
    void EXIF_6은_오른쪽으로_90도() {
        OcrImage out = image.orient(6);

        assertThat(out.width()).isEqualTo(2);
        assertThat(out.height()).isEqualTo(3);
        assertThat(out.pixels()).containsExactly(4, 1, 5, 2, 6, 3);
    }

    @Test
    void EXIF_8은_왼쪽으로_90도() {
        assertThat(image.orient(8).pixels()).containsExactly(3, 6, 2, 5, 1, 4);
    }

    @Test
    void EXIF_3은_180도() {
        assertThat(image.orient(3).pixels()).containsExactly(6, 5, 4, 3, 2, 1);
    }

    @Test
    void JPEG_EXIF_방향을_읽는다() {
        // SOI, APP1(Exif, 리틀 엔디안 TIFF, IFD0 항목 1개: Orientation=6), EOI
        byte[] jpeg = {
                (byte) 0xFF, (byte) 0xD8,
                (byte) 0xFF, (byte) 0xE1, 0x00, 0x22,
                'E', 'x', 'i', 'f', 0, 0,
                'I', 'I', 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00,
                0x01, 0x00,
                0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00,
                (byte) 0xFF, (byte) 0xD9
        };
        assertThat(OcrImage.exifOrientation(jpeg)).isEqualTo(6);
        assertThat(OcrImage.exifOrientation(new byte[]{(byte) 0x89, 'P', 'N', 'G'})).isEqualTo(1);
    }

    @Test
    void 이미지가_아니면_읽을_수_없음() {
        assertThatThrownBy(() -> OcrImage.decode(new byte[]{1, 2, 3}, "image/png"))
                .isInstanceOf(OcrException.class)
                .extracting(e -> ((OcrException) e).kind())
                .isEqualTo(OcrException.Kind.UNREADABLE_INPUT);
    }
}
