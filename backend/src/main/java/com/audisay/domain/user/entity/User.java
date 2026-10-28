package com.audisay.domain.user.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;

@Entity
@Table(name = "users")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 255)
    private String email;

    @Column(nullable = false, length = 100)
    private String passwordHash;

    @Column(nullable = false, length = 50)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Role role;

    private Instant verifiedAt;

    private Instant withdrawnAt;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(nullable = false)
    private Instant updatedAt;

    public static User create(String email, String passwordHash, String name) {
        User user = new User();
        user.email = email;
        user.passwordHash = passwordHash;
        user.name = name;
        user.role = Role.GENERAL;
        return user;
    }

    public boolean isWithdrawn() {
        return withdrawnAt != null;
    }

    public boolean isVerified() {
        return verifiedAt != null;
    }

    public void changePassword(String passwordHash) {
        this.passwordHash = passwordHash;
    }

    /** 소프트 삭제. 행은 남기고 탈퇴 시각만 기록한다 */
    public void withdraw(Instant now) {
        this.withdrawnAt = now;
    }

    /** 시각장애인 인증(형식상 자동 승인). DB의 ck_users_verified 때문에 인증 시각과 역할을 함께 바꾼다 */
    public void verifyVisuallyImpaired(Instant now) {
        this.verifiedAt = now;
        this.role = Role.VISUALLY_IMPAIRED;
    }
}
