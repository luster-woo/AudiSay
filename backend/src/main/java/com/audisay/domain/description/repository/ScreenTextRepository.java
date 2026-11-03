package com.audisay.domain.description.repository;

import com.audisay.domain.description.entity.ScreenText;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ScreenTextRepository extends JpaRepository<ScreenText, Long> {

    List<ScreenText> findByDescription_IdOrderByStartMsAsc(Long descriptionId);

    List<ScreenText> findByDescription_IdAndStartMsBetweenOrderByStartMsAsc(Long descriptionId, Integer fromMs, Integer toMs);
}
