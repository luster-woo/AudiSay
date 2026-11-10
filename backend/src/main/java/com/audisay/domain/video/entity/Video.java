package com.audisay.domain.video.entity;

import com.audisay.domain.user.entity.Role;
import com.audisay.domain.user.entity.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;

/**
 * 유튜브 영상과 업로드 영상의 공통 정보. 유튜브는 youtubeVideoId가 있고 uploader가 없으며, 업로드는 그 반대다(ck_videos_source).
 */
@Entity
@Table(name = "videos")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Video {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private SourceType sourceType;

    @Column(length = 20)
    private String youtubeVideoId;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "uploader_id")
    private User uploader;

    @Column(nullable = false, length = 300)
    private String title;

    private String sourceDescription;

    @Column(length = 200)
    private String channelTitle;

    /** 유튜브는 썸네일 주소, 업로드는 S3 키(비공개 버킷이라 응답 때 ThumbnailUrlResolver가 presigned 주소로 바꾼다) */
    @Column(length = 500)
    private String thumbnailUrl;

    @Column(nullable = false)
    private Integer durationSec;

    @Enumerated(EnumType.STRING)
    @Column(length = 20)
    private Category category;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private Visibility visibility = Visibility.PRIVATE;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 15)
    private VideoStatus status = VideoStatus.REGISTERED;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(nullable = false)
    private Instant updatedAt;

    /** 업로드 시작 시점의 영상. 파일을 다 올릴 때까지 UPLOADING이다 */
    public static Video createUpload(User uploader, String title, int durationSec, Visibility visibility) {
        Video video = new Video();
        video.sourceType = SourceType.UPLOAD;
        video.uploader = uploader;
        video.title = title;
        video.durationSec = durationSec;
        video.visibility = visibility;
        video.status = VideoStatus.UPLOADING;
        return video;
    }

    /** 해설을 처음 요청받은 유튜브 영상. 유튜브 영상은 모두에게 공개한다 */
    public static Video createYoutube(String youtubeVideoId, String title, String channelTitle, String thumbnailUrl,
                                      int durationSec) {
        Video video = new Video();
        video.sourceType = SourceType.YOUTUBE;
        video.youtubeVideoId = youtubeVideoId;
        video.title = title;
        video.channelTitle = channelTitle;
        video.thumbnailUrl = thumbnailUrl;
        video.durationSec = durationSec;
        video.visibility = Visibility.PUBLIC;
        video.status = VideoStatus.REGISTERED;
        return video;
    }

    /** 워커가 만든 업로드 영상 썸네일(LOCAL prepare 완료 때) */
    public void attachUploadThumbnail(String thumbnailKey) {
        if (sourceType == SourceType.UPLOAD) {
            this.thumbnailUrl = thumbnailKey;
        }
    }

    /** 업로드한 회원인지. 유튜브 영상은 올린 회원이 없어 항상 false다 */
    public boolean isUploadedBy(Long userId) {
        return uploader != null && uploader.getId().equals(userId);
    }

    /** 볼 수 있는 회원인지. 비공개 영상은 올린 회원과 관리자만 볼 수 있다 */
    public boolean isViewableBy(Long userId, Role role) {
        return visibility != Visibility.PRIVATE || isUploadedBy(userId) || role == Role.ADMIN;
    }

    public boolean isAvailable() {
        return status != VideoStatus.UNAVAILABLE;
    }

    /**
     * 유튜브에서 지워졌거나 비공개로 바뀌었다(다시 요청할 때 확인했거나, 작업이 VIDEO_UNAVAILABLE로 실패).
     * 즐겨찾기·내 영상 목록에서 '볼 수 없음'으로 보인다
     */
    public void markUnavailable() {
        if (sourceType == SourceType.YOUTUBE) {
            this.status = VideoStatus.UNAVAILABLE;
        }
    }

    /** 다시 확인해 보니 볼 수 있다 (비공개였다가 다시 공개됨) */
    public void markAvailable() {
        if (status == VideoStatus.UNAVAILABLE) {
            this.status = VideoStatus.REGISTERED;
        }
    }

    public void changeVisibility(Visibility visibility) {
        this.visibility = visibility;
    }

    public void changeCategory(Category category) {
        this.category = category;
    }

    /** 파일을 다 올렸다. (VideoStatus.READY는 쓰지 않는다: 해설이 있는지는 해설 상태(DescriptionStateReader)로 본다) */
    public void finishUpload() {
        this.status = VideoStatus.REGISTERED;
    }
}
