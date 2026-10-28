package com.audisay.domain.description.repository;

import com.audisay.domain.description.entity.Chapter;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ChapterRepository extends JpaRepository<Chapter, Long> {

    List<Chapter> findByDescription_IdOrderByChapterIndexAsc(Long descriptionId);
}