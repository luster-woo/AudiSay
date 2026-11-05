package com.audisay.global.external.s3;

import org.junit.jupiter.api.Test;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.S3Exception;

import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class UploadThumbnailStoreTest {
    private final S3Client s3Client = mock(S3Client.class);

    @Test
    @SuppressWarnings("unchecked")
    void 원본과_함께_지워지지_않게_따로_복사한_키를_쓴다() {
        UploadThumbnailStore store = new UploadThumbnailStore(s3Client, properties("bucket"));

        assertThat(store.keep(7L)).isEqualTo("thumbnails/uploads/7.jpg");
        verify(s3Client).copyObject(any(Consumer.class));
    }

    @Test
    @SuppressWarnings("unchecked")
    void 복사하지_못하면_워커가_올린_키를_쓴다() {
        when(s3Client.copyObject(any(Consumer.class))).thenThrow(S3Exception.builder().statusCode(403).build());
        UploadThumbnailStore store = new UploadThumbnailStore(s3Client, properties("bucket"));

        assertThat(store.keep(7L)).isEqualTo("uploads/7/thumb.jpg");
    }

    @Test
    void 버킷이_없으면_S3를_부르지_않는다() {
        UploadThumbnailStore store = new UploadThumbnailStore(s3Client, properties(null));

        assertThat(store.keep(7L)).isEqualTo("uploads/7/thumb.jpg");
        verifyNoInteractions(s3Client);
    }

    private static S3Properties properties(String bucket) {
        return new S3Properties("ap-northeast-2", bucket, null, null, null, null, null, null, null);
    }
}
