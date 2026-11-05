package com.audisay.global.external.ocr;

import org.junit.jupiter.api.Test;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.zip.CRC32;

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
    void 건너뛰며_읽는_칸_수는_읽은_화소가_4000x4000_이하가_되게() {
        assertThat(OcrImage.subsampling(4000, 3000)).isEqualTo(1);
        assertThat(OcrImage.subsampling(4000, 4000)).isEqualTo(1);
        assertThat(OcrImage.subsampling(8160, 6120)).isEqualTo(2);
        assertThat(OcrImage.subsampling(12000, 9000)).isEqualTo(3);
    }

    @Test
    void 큰_이미지는_디코딩할_때부터_줄여_읽는다() throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(6000, 4000, BufferedImage.TYPE_BYTE_GRAY), "png", out);

        OcrImage image = OcrImage.decode(out.toByteArray(), "image/png");

        assertThat(image.width()).isEqualTo(3000);
        assertThat(image.height()).isEqualTo(2000);
    }

    @Test
    void 화소가_너무_많으면_본문을_디코딩하지_않고_거절() {
        byte[] png = pngHeaderOnly(12_000, 12_000);

        assertThatThrownBy(() -> OcrImage.decode(png, "image/png"))
                .isInstanceOf(OcrException.class)
                .hasNoCause()
                .extracting(e -> ((OcrException) e).kind())
                .isEqualTo(OcrException.Kind.UNREADABLE_INPUT);
    }

    @Test
    void 이미지가_아니면_읽을_수_없음() {
        assertThatThrownBy(() -> OcrImage.decode(new byte[]{1, 2, 3}, "image/png"))
                .isInstanceOf(OcrException.class)
                .extracting(e -> ((OcrException) e).kind())
                .isEqualTo(OcrException.Kind.UNREADABLE_INPUT);
    }

    /** 머리글(IHDR)만 있는 PNG(흑백 8비트). 크기는 머리글로만 알 수 있고 본문은 없다 */
    private static byte[] pngHeaderOnly(int width, int height) {
        ByteBuffer ihdr = ByteBuffer.allocate(13).putInt(width).putInt(height).put((byte) 8).put((byte) 0)
                .put((byte) 0).put((byte) 0).put((byte) 0);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.writeBytes(new byte[]{(byte) 0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n'});
        chunk(out, "IHDR", ihdr.array());
        chunk(out, "IEND", new byte[0]);
        return out.toByteArray();
    }

    private static void chunk(ByteArrayOutputStream out, String type, byte[] data) {
        byte[] name = type.getBytes(StandardCharsets.US_ASCII);
        CRC32 crc = new CRC32();
        crc.update(name);
        crc.update(data);
        out.writeBytes(ByteBuffer.allocate(4).putInt(data.length).array());
        out.writeBytes(name);
        out.writeBytes(data);
        out.writeBytes(ByteBuffer.allocate(4).putInt((int) crc.getValue()).array());
    }
}
