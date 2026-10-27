package com.audisay.domain.favorite.repository;

import com.audisay.domain.favorite.entity.Favorite;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.Set;

public interface FavoriteRepository extends JpaRepository<Favorite, Favorite.FavoriteId> {

    boolean existsByUserIdAndVideoId(Long userId, Long videoId);

    /**
     * 주어진 영상 중 이 회원이 즐겨찾기에 넣은 영상 ID.
     */
    @Query("select f.videoId from Favorite f where f.userId = :userId and f.videoId in :videoIds")
    Set<Long> findVideoIds(@Param("userId") Long userId, @Param("videoIds") Collection<Long> videoIds);
}
