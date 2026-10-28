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
@Table(name = "description_lines")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class DescriptionLine {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "description_id", nullable = false)
    private Description description;

    @Column(nullable = false)
    private Integer lineIndex;

    /** 이 단계부터 읽는다(누적형). 1~3 */
    @Column(nullable = false)
    private Short detailLevel;

    @Column(nullable = false)
    private Integer startMs;

    /** 다음 대사가 나오기 전까지. 해설을 넣을 수 있는 빈 구간의 끝 */
    private Integer gapEndMs;

    /** 1~3, 높을수록 중요 (= 4 - detailLevel) */
    @Column(nullable = false)
    private Short importance;

    @Column(nullable = false)
    private String text;

    @Column(length = 500)
    private String audioKey;

    private Integer audioDurationMs;
}