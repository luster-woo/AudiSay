package com.audisay.domain.description.repository;

import com.audisay.domain.description.entity.Description;
import com.audisay.domain.description.entity.DescriptionStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

public interface DescriptionRepository extends JpaRepository<Description, Long> {

    List<Description> findByVideo_IdInAndStatus(Collection<Long> videoIds, DescriptionStatus status);
}
