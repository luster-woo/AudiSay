package com.audisay.domain.description.entity;

import com.audisay.domain.job.entity.Job;
import com.audisay.domain.video.entity.Video;
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
import jakarta.persistence.OneToOne;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;

/**
 * 작업 하나가 만든 해설 한 벌. 재생에 쓰는 공개(PUBLISHED) 해설은 영상당 하나다(uq_descriptions_published).
 */
@Entity
@Table(name = "descriptions")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Description {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "video_id", nullable = false)
    private Video video;

    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "job_id", nullable = false, unique = true)
    private Job job;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 15)
    private DescriptionStatus status = DescriptionStatus.GENERATING;

    /** 30초 요약 */
    private String summaryText;

    /** 요약 음성 S3 키 */
    @Column(length = 500)
    private String summaryAudioKey;

    private Integer summaryDurationMs;

    @Column(length = 50)
    private String modelName;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant createdAt;
}
