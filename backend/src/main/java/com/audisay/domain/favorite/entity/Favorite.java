package com.audisay.domain.favorite.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.io.Serializable;
import java.time.Instant;

/**
 * 즐겨찾기. (회원, 영상)이 기본 키라 같은 영상을 두 번 넣을 수 없다.
 */
@Entity
@Table(name = "favorites")
@IdClass(Favorite.FavoriteId.class)
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Favorite {
    @Id
    private Long userId;

    @Id
    private Long videoId;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    public record FavoriteId(Long userId, Long videoId) implements Serializable {
    }
}
