package com.audisay.domain.description.repository;

import com.audisay.domain.description.entity.Scene;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SceneRepository extends JpaRepository<Scene, Long> {

    List<Scene> findByDescription_IdOrderBySceneIndexAsc(Long descriptionId);
}