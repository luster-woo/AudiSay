package com.audisay.global.external.ocr;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.rendering.ImageType;
import org.apache.pdfbox.rendering.PDFRenderer;

import javax.imageio.ImageIO;
import javax.imageio.ImageReadParam;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Iterator;

/**
 * OCR용 RGB 이미지(메모리에만). 크기 바꾸기·자르기는 OpenCV INTER_LINEAR와 같은 방식(픽셀 중심 기준, 가장자리 복제).
 */
public final class OcrImage {
    /** PaddleOCR max_side_limit와 같다 */
    static final int MAX_SIDE = 4000;
    /** 이보다 화소가 많은 이미지는 읽지 않는다(1억 800만 화소 폰 사진까지). 작은 파일로 수 GB를 잡는 압축 폭탄 방어 */
    static final long MAX_PIXELS = 120_000_000L;
    /** 디코딩 때 이 화소 수 이하가 되게 건너뛰며 읽는다(4000 × 4000) */
    static final long DECODE_PIXELS = 16_000_000L;
    private static final float PDF_DPI = 200f;

    private final int width;
    private final int height;
    private final int[] rgb;

    OcrImage(int width, int height, int[] rgb) {
        this.width = width;
        this.height = height;
        this.rgb = rgb;
    }

    public int width() {
        return width;
    }

    public int height() {
        return height;
    }

    /** PDF는 첫 장만, JPEG는 EXIF 방향을 반영한다 */
    public static OcrImage decode(byte[] bytes, String contentType) {
        if ("application/pdf".equalsIgnoreCase(contentType)) {
            return of(renderPdf(bytes), 1);
        }
        return of(readImage(bytes), exifOrientation(bytes));
    }

    /** 머리글로 크기를 먼저 보고, 너무 크면 거절, 크면 건너뛰며 읽는다(디코딩 전에 메모리 상한을 정함) */
    private static BufferedImage readImage(byte[] bytes) {
        try (ImageInputStream in = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
            Iterator<ImageReader> readers = in == null ? null : ImageIO.getImageReaders(in);
            if (readers == null || !readers.hasNext()) {
                throw unreadable(null);
            }
            ImageReader reader = readers.next();
            try {
                reader.setInput(in, true, true);
                long width = reader.getWidth(0);
                long height = reader.getHeight(0);
                if (width <= 0 || height <= 0 || width * height > MAX_PIXELS) {
                    throw unreadable(null);
                }
                ImageReadParam param = reader.getDefaultReadParam();
                int step = subsampling(width, height);
                if (step > 1) {
                    param.setSourceSubsampling(step, step, 0, 0);
                }
                return reader.read(0, param);
            } finally {
                reader.dispose();
            }
        } catch (OcrException e) {
            throw e;
        } catch (IOException | RuntimeException e) {
            throw unreadable(e);
        }
    }

    /** 가로·세로를 몇 칸마다 하나씩 읽을지(1이면 전부). 읽은 화소 수가 DECODE_PIXELS 이하가 된다 */
    static int subsampling(long width, long height) {
        return (int) Math.max(1, Math.ceil(Math.sqrt((double) width * height / DECODE_PIXELS)));
    }

    static OcrImage of(BufferedImage image, int orientation) {
        int w = image.getWidth();
        int h = image.getHeight();
        int[] px = image.getRGB(0, 0, w, h, null, 0, w);
        for (int i = 0; i < px.length; i++) {
            px[i] = onWhite(px[i]);
        }
        OcrImage img = new OcrImage(w, h, px).orient(orientation);
        double r = (double) MAX_SIDE / Math.max(img.width, img.height);
        return r < 1 ? img.resize((int) Math.round(img.width * r), (int) Math.round(img.height * r)) : img;
    }

    private static BufferedImage renderPdf(byte[] bytes) {
        try (PDDocument doc = Loader.loadPDF(bytes)) {
            if (doc.getNumberOfPages() == 0) {
                throw unreadable(null);
            }
            PDRectangle box = doc.getPage(0).getCropBox();
            float longPt = Math.max(box.getWidth(), box.getHeight());
            float dpi = Math.min(PDF_DPI, MAX_SIDE * 72f / longPt);
            return new PDFRenderer(doc).renderImageWithDPI(0, dpi, ImageType.RGB);
        } catch (IOException | RuntimeException e) {
            if (e instanceof OcrException oe) {
                throw oe;
            }
            throw unreadable(e);
        }
    }

    private static OcrException unreadable(Throwable cause) {
        return new OcrException(OcrException.Kind.UNREADABLE_INPUT, "서류 파일을 이미지로 읽지 못했습니다.", cause);
    }

    /** 투명한 부분은 흰 바탕으로 */
    private static int onWhite(int argb) {
        int a = argb >>> 24;
        if (a == 255) {
            return argb & 0xFFFFFF;
        }
        int r = ((argb >> 16) & 0xFF) * a / 255 + 255 - a;
        int g = ((argb >> 8) & 0xFF) * a / 255 + 255 - a;
        int b = (argb & 0xFF) * a / 255 + 255 - a;
        return (r << 16) | (g << 8) | b;
    }

    /** OpenCV INTER_LINEAR와 같은 크기 바꾸기 */
    OcrImage resize(int newWidth, int newHeight) {
        int[] out = new int[newWidth * newHeight];
        double sx = (double) width / newWidth;
        double sy = (double) height / newHeight;
        for (int y = 0; y < newHeight; y++) {
            double fy = (y + 0.5) * sy - 0.5;
            for (int x = 0; x < newWidth; x++) {
                out[y * newWidth + x] = sample((x + 0.5) * sx - 0.5, fy);
            }
        }
        return new OcrImage(newWidth, newHeight, out);
    }

    /**
     * 크기를 바꾸며 정규화한 값을 CHW(B, G, R 순서 — PaddleOCR가 OpenCV BGR로 학습)로 쓴다.
     * 값 = (화소/255 - mean[c]) / std[c]. rowStride보다 좁으면 나머지 칸은 건드리지 않는다(0 채움 유지).
     */
    void writeChw(float[] dst, int offset, int rowStride, int outWidth, int outHeight, float[] mean, float[] std) {
        int plane = outHeight * rowStride;
        double sx = (double) width / outWidth;
        double sy = (double) height / outHeight;
        for (int y = 0; y < outHeight; y++) {
            double fy = (y + 0.5) * sy - 0.5;
            for (int x = 0; x < outWidth; x++) {
                int p = sample((x + 0.5) * sx - 0.5, fy);
                int i = offset + y * rowStride + x;
                dst[i] = ((p & 0xFF) / 255f - mean[0]) / std[0];
                dst[i + plane] = (((p >> 8) & 0xFF) / 255f - mean[1]) / std[1];
                dst[i + 2 * plane] = (((p >> 16) & 0xFF) / 255f - mean[2]) / std[2];
            }
        }
    }

    /**
     * 글자 상자 하나를 똑바로 펴서 잘라 낸다(PaddleOCR get_rotate_crop_image). 세로로 긴 상자(높이/너비 1.5 이상)는 왼쪽으로 90도 돌린다.
     *
     * @return 너비나 높이가 0이면 null
     */
    OcrImage crop(BoxGeometry.Quad q) {
        double[] xs = q.xs();
        double[] ys = q.ys();
        int w = (int) Math.max(Math.hypot(xs[0] - xs[1], ys[0] - ys[1]), Math.hypot(xs[2] - xs[3], ys[2] - ys[3]));
        int h = (int) Math.max(Math.hypot(xs[0] - xs[3], ys[0] - ys[3]), Math.hypot(xs[1] - xs[2], ys[1] - ys[2]));
        if (w <= 0 || h <= 0) {
            return null;
        }
        double ux = (xs[1] - xs[0]) / w, uy = (ys[1] - ys[0]) / w;
        double vx = (xs[3] - xs[0]) / h, vy = (ys[3] - ys[0]) / h;
        int[] out = new int[w * h];
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                out[y * w + x] = sample(xs[0] + ux * x + vx * y, ys[0] + uy * x + vy * y);
            }
        }
        OcrImage img = new OcrImage(w, h, out);
        return (double) h / w >= 1.5 ? img.rotateLeft() : img;
    }

    /** numpy rot90(왼쪽으로 90도) */
    private OcrImage rotateLeft() {
        int[] out = new int[rgb.length];
        for (int y = 0; y < width; y++) {
            for (int x = 0; x < height; x++) {
                out[y * height + x] = rgb[x * width + (width - 1 - y)];
            }
        }
        return new OcrImage(height, width, out);
    }

    /** EXIF 방향(1~8)대로 바로 세운다 */
    OcrImage orient(int orientation) {
        if (orientation <= 1 || orientation > 8) {
            return this;
        }
        boolean swap = orientation >= 5;
        int ow = swap ? height : width;
        int oh = swap ? width : height;
        int[] out = new int[rgb.length];
        for (int y = 0; y < oh; y++) {
            for (int x = 0; x < ow; x++) {
                int sx, sy;
                switch (orientation) {
                    case 2 -> { sx = width - 1 - x; sy = y; }
                    case 3 -> { sx = width - 1 - x; sy = height - 1 - y; }
                    case 4 -> { sx = x; sy = height - 1 - y; }
                    case 5 -> { sx = y; sy = x; }
                    case 6 -> { sx = y; sy = height - 1 - x; }
                    case 7 -> { sx = width - 1 - y; sy = height - 1 - x; }
                    default -> { sx = width - 1 - y; sy = x; }
                }
                out[y * ow + x] = rgb[sy * width + sx];
            }
        }
        return new OcrImage(ow, oh, out);
    }

    private int sample(double fx, double fy) {
        int x0 = (int) Math.floor(fx);
        int y0 = (int) Math.floor(fy);
        double wx = fx - x0;
        double wy = fy - y0;
        int xa = clamp(x0, width), xb = clamp(x0 + 1, width);
        int ya = clamp(y0, height), yb = clamp(y0 + 1, height);
        int p00 = rgb[ya * width + xa], p01 = rgb[ya * width + xb];
        int p10 = rgb[yb * width + xa], p11 = rgb[yb * width + xb];
        int out = 0;
        for (int shift = 0; shift <= 16; shift += 8) {
            double top = ((p00 >> shift) & 0xFF) * (1 - wx) + ((p01 >> shift) & 0xFF) * wx;
            double bottom = ((p10 >> shift) & 0xFF) * (1 - wx) + ((p11 >> shift) & 0xFF) * wx;
            int v = (int) Math.round(top * (1 - wy) + bottom * wy);
            out |= Math.clamp(v, 0, 255) << shift;
        }
        return out;
    }

    private static int clamp(int v, int size) {
        return v < 0 ? 0 : Math.min(v, size - 1);
    }

    /** JPEG EXIF Orientation 값(없으면 1) */
    static int exifOrientation(byte[] b) {
        if (b.length < 4 || (b[0] & 0xFF) != 0xFF || (b[1] & 0xFF) != 0xD8) {
            return 1;
        }
        int i = 2;
        while (i + 4 <= b.length) {
            if ((b[i] & 0xFF) != 0xFF) {
                return 1;
            }
            int marker = b[i + 1] & 0xFF;
            if (marker == 0xDA || marker == 0xD9) {
                return 1;
            }
            if (marker == 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
                i += 2;
                continue;
            }
            int len = u16(b, i + 2, false);
            if (marker == 0xE1 && i + 10 <= b.length && b[i + 4] == 'E' && b[i + 5] == 'x' && b[i + 6] == 'i'
                    && b[i + 7] == 'f' && b[i + 8] == 0 && b[i + 9] == 0) {
                return tiffOrientation(b, i + 10, Math.min(b.length, i + 2 + len));
            }
            i += 2 + len;
        }
        return 1;
    }

    private static int tiffOrientation(byte[] b, int start, int end) {
        if (start + 8 > end) {
            return 1;
        }
        boolean little = b[start] == 'I' && b[start + 1] == 'I';
        if (!little && !(b[start] == 'M' && b[start + 1] == 'M')) {
            return 1;
        }
        long ifd = start + u32(b, start + 4, little);
        if (ifd < start || ifd + 2 > end) {
            return 1;
        }
        int count = u16(b, (int) ifd, little);
        for (int k = 0; k < count; k++) {
            int e = (int) ifd + 2 + k * 12;
            if (e + 12 > end) {
                break;
            }
            if (u16(b, e, little) == 0x0112) {
                int v = u16(b, e + 8, little);
                return v >= 1 && v <= 8 ? v : 1;
            }
        }
        return 1;
    }

    private static int u16(byte[] b, int i, boolean little) {
        int a = b[i] & 0xFF, c = b[i + 1] & 0xFF;
        return little ? (c << 8) | a : (a << 8) | c;
    }

    private static long u32(byte[] b, int i, boolean little) {
        long hi = u16(b, little ? i + 2 : i, little);
        long lo = u16(b, little ? i : i + 2, little);
        return (hi << 16) | lo;
    }

    int[] pixels() {
        return rgb;
    }
}
