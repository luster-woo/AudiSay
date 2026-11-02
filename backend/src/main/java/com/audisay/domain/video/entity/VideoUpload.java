package com.audisay.domain.video.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.MapsId;
import jakarta.persistence.OneToOne;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;

/**
 * 업로드 영상의 파일 정보(videos와 1:1). 브라우저가 S3에 직접 올리는 멀티파트 업로드와 재생용 파일 변환 상태를 기록한다.
 * 변환 상태·재생용 파일 위치는 워커 이벤트를 받는 쪽이 채운다.
 */
@Entity
@Table(name = "video_uploads")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class VideoUpload {
    @Id
    private Long videoId;

    @MapsId
    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "video_id")
    private Video video;

    @Column(nullable = false, length = 500)
    private String originalKey;

    private String s3UploadId;

    @Column(nullable = false)
    private String originalFilename;

    @Column(nullable = false, length = 30)
    private String contentType;

    @Column(nullable = false)
    private Long sizeBytes;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 15)
    private UploadStatus uploadStatus = UploadStatus.INITIATED;

    @Column(length = 500)
    private String playbackKey;

    @Enumerated(EnumType.STRING)
    @Column(length = 5)
    private PlaybackFormat playbackFormat;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private TranscodeStatus transcodeStatus = TranscodeStatus.PENDING;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    private Instant completedAt;

    public static VideoUpload create(Video video, String originalKey, String s3UploadId,
                                     String originalFilename, VideoFormat format, long sizeBytes) {
        VideoUpload upload = new VideoUpload();
        upload.video = video;
        upload.originalKey = originalKey;
        upload.s3UploadId = s3UploadId;
        upload.originalFilename = originalFilename;
        upload.contentType = format.getContentType();
        upload.sizeBytes = sizeBytes;
        return upload;
    }

    /** 완료(COMPLETED)나 중단(ABORTED)되어 더 올릴 수 없는지 */
    public boolean isClosed() {
        return uploadStatus == UploadStatus.COMPLETED || uploadStatus == UploadStatus.ABORTED;
    }

    /** 조각 주소를 처음 발급할 때 */
    public void startUploading() {
        if (uploadStatus == UploadStatus.INITIATED) {
            uploadStatus = UploadStatus.UPLOADING;
        }
    }

    public void complete(Instant now) {
        uploadStatus = UploadStatus.COMPLETED;
        completedAt = now;
    }

    /** 워커가 재생용 파일을 만들었다. HLS 목록(.m3u8)이 아니면 MP4로 본다 */
    public void finishTranscode(String playbackKey) {
        this.playbackKey = playbackKey;
        this.playbackFormat = playbackKey.endsWith(".m3u8") ? PlaybackFormat.HLS : PlaybackFormat.MP4;
        this.transcodeStatus = TranscodeStatus.DONE;
    }

    /** 재생용 파일을 만들기 전에 작업이 실패했다. 이미 만들었으면 그대로 둔다 */
    public void failTranscode() {
        if (transcodeStatus != TranscodeStatus.DONE) {
            this.transcodeStatus = TranscodeStatus.FAILED;
        }
    }

    /** 변환이 끝나 재생용 파일이 있는지 */
    public boolean isPlayable() {
        return transcodeStatus == TranscodeStatus.DONE && playbackKey != null;
    }
}
