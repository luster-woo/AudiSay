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
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;

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

    /** 화면 해설(NARRATION) / 외국어 대사 번역(DIALOGUE). 칸이 생기기 전 해설은 모두 NARRATION(DubLines가 글로 한 번 더 가른다) */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private LineType lineType = LineType.NARRATION;

    @Column(length = 500)
    private String audioKey;

    private Integer audioDurationMs;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(nullable = false)
    private Instant updatedAt;

    /**
     * 관리자가 문장을 고친다. importance가 null이면 그대로 둔다.
     * 문장 글자가 바뀐 경우에만 옛 음성을 비운다(line.tts로 다시 만든다). 중요도만 바꿨으면 음성은 그대로 둔다.
     * 상세도는 (해설, 문장 순서, 상세도) 유니크 키라 바꾸지 않는다.
     *
     * @return 글자가 바뀌어 음성을 다시 만들어야 하면 true
     */
    public boolean edit(String text, Short importance) {
        boolean textChanged = !text.equals(this.text);
        this.text = text;
        if (importance != null) {
            this.importance = importance;
        }
        if (textChanged) {
            clearAudio();
        }
        return textChanged;
    }

    /** 음성을 비운다. 새 음성이 나올 때까지 플레이어는 브라우저 음성으로 읽는다 */
    public void clearAudio() {
        this.audioKey = null;
        this.audioDurationMs = null;
    }
}
