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

    public void changeVisibility(Visibility visibility) {
        this.visibility = visibility;
    }

    /** 파일을 다 올렸다. 해설이 완성되면 READY가 된다 */
    public void finishUpload() {
        this.status = VideoStatus.REGISTERED;
    }
}
