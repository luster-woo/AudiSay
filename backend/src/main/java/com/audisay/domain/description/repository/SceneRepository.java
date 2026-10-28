package com.audisay.domain.description.repository;

import com.audisay.domain.description.entity.Scene;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface SceneRepository extends JpaRepository<Scene, Long> {

    List<Scene> findByDescription_IdOrderBySceneIndexAsc(Long descriptionId);

    @Query("""
            select s from Scene s
            where s.description.id = :descriptionId
              and s.startMs <= :ms
              and s.endMs > :ms
            """)
    Optional<Scene> findAtTime(Long descriptionId, Integer ms);
}