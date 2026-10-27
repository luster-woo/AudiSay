package com.audisay.domain.user.repository;

import com.audisay.domain.user.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface UserRepository extends JpaRepository<User, Long> {
    Optional<User> findByEmailAndWithdrawnAtIsNull(String email);

    boolean existsByEmailAndWithdrawnAtIsNull(String email);
}
