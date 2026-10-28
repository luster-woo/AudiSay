package com.audisay.domain.description.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
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

@Entity
@Table(name = "transcript_segments")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class TranscriptSegment {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "description_id", nullable = false)
    private Description description;

    @Column(nullable = false)
    private Integer startMs;

    @Column(nullable = false)
    private Integer endMs;

    @Column(nullable = false)
    private String text;

    /** 이름이 확인된 인물과 연결된 대사만 값이 있다 */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "character_id")
    private Character character;
}