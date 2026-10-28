package com.audisay.domain.favorite.repository;

import com.audisay.domain.favorite.entity.Favorite;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
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

    /**
     * 즐겨찾기에 넣은 순서의 역순(최근 먼저)이다.
     */
    @Query(value = """
            select f from Favorite f
            where f.userId = :userId
            order by f.createdAt desc, f.videoId desc
            """,
            countQuery = "select count(f) from Favorite f where f.userId = :userId")
    Page<Favorite> findLatestByUserId(@Param("userId") Long userId, Pageable pageable);

    /**
     * 이미 있으면 아무것도 하지 않는다. 같은 요청이 동시에 와도 기본 키 충돌 없이 한 행만 남는다.
     */
    @Modifying
    @Query(value = "INSERT INTO favorites (user_id, video_id) VALUES (:userId, :videoId) ON CONFLICT DO NOTHING",
            nativeQuery = true)
    void insertIfAbsent(@Param("userId") Long userId, @Param("videoId") Long videoId);

    @Modifying
    @Query("delete from Favorite f where f.userId = :userId and f.videoId = :videoId")
    void deleteByUserIdAndVideoId(@Param("userId") Long userId, @Param("videoId") Long videoId);
}
