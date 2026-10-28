package com.audisay.domain.description.entity;

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

@Entity
@Table(name = "screen_texts")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ScreenText {
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

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 15)
    private ScreenTextType textType = ScreenTextType.OTHER;

    @Column(length = 300)
    private String headline;

    @Column(nullable = false)
    private String fullText;

    private String summaryText;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 6)
    private ScreenTextImportance importance;

    @Column(nullable = false)
    private Boolean sameAsDialogue = false;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "character_id")
    private Character character;
}