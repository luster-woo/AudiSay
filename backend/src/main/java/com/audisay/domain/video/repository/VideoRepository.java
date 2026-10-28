package com.audisay.domain.video.repository;

import com.audisay.domain.video.entity.Category;
import com.audisay.domain.video.entity.Video;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface VideoRepository extends JpaRepository<Video, Long> {

    Optional<Video> findByYoutubeVideoId(String youtubeVideoId);

    List<Video> findByYoutubeVideoIdIn(Collection<String> youtubeVideoIds);

    /**
     * 공개 해설이 있는 공개 영상. 공개 해설을 만든 시각 최신순이다. category가 null이면 전체.
     */
    @Query(value = """
            select v from Description d join d.video v
            where d.status = com.audisay.domain.description.entity.DescriptionStatus.PUBLISHED
              and v.visibility = com.audisay.domain.video.entity.Visibility.PUBLIC
              and v.status = com.audisay.domain.video.entity.VideoStatus.READY
              and (:category is null or v.category = :category)
            order by d.createdAt desc, v.id desc
            """,
            countQuery = """
            select count(d) from Description d join d.video v
            where d.status = com.audisay.domain.description.entity.DescriptionStatus.PUBLISHED
              and v.visibility = com.audisay.domain.video.entity.Visibility.PUBLIC
              and v.status = com.audisay.domain.video.entity.VideoStatus.READY
              and (:category is null or v.category = :category)
            """)
    Page<Video> findPublished(@Param("category") Category category, Pageable pageable);
}
