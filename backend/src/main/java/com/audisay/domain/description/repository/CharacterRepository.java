package com.audisay.domain.description.repository;

import com.audisay.domain.description.entity.Character;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface CharacterRepository extends JpaRepository<Character, Long> {

    List<Character> findByDescription_IdOrderByIdAsc(Long descriptionId);
}
