package com.audisay.domain.user.repository;

import com.audisay.domain.user.entity.Role;
import com.audisay.domain.user.entity.User;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface UserRepository extends JpaRepository<User, Long> {
    Optional<User> findByEmailAndWithdrawnAtIsNull(String email);

    boolean existsByEmailAndWithdrawnAtIsNull(String email);

    /**
     * 관리자 회원 목록. 가입 최신순이다. role·pattern이 null이면 거르지 않는다.
     * pattern은 소문자로 바꾸고 %, _, !를 '!'로 이스케이프한 LIKE 패턴이다.
     */
    @Query(value = """
            select u from User u
            where (:role is null or u.role = :role)
              and (:includeWithdrawn = true or u.withdrawnAt is null)
              and (:pattern is null or lower(u.email) like :pattern escape '!' or lower(u.name) like :pattern escape '!')
            order by u.createdAt desc, u.id desc
            """,
            countQuery = """
            select count(u) from User u
            where (:role is null or u.role = :role)
              and (:includeWithdrawn = true or u.withdrawnAt is null)
              and (:pattern is null or lower(u.email) like :pattern escape '!' or lower(u.name) like :pattern escape '!')
            """)
    Page<User> searchForAdmin(@Param("role") Role role,
                              @Param("pattern") String pattern,
                              @Param("includeWithdrawn") boolean includeWithdrawn,
                              Pageable pageable);
}
