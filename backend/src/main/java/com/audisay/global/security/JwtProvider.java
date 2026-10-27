package com.audisay.global.security;

import com.audisay.domain.user.entity.Role;
import com.audisay.global.config.JwtProperties;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.Optional;
import java.util.UUID;

@Component
public class JwtProvider {
    private static final String BEARER_PREFIX = "Bearer ";
    private static final String CLAIM_ROLE = "role";
    private static final String CLAIM_SID = "sid";
    private static final String CLAIM_TYPE = "type";
    private static final String TYPE_ACCESS = "access";
    private static final String TYPE_REFRESH = "refresh";

    private final SecretKey key;
    private final Duration accessTokenExpiration;
    private final Duration refreshTokenExpiration;

    public JwtProvider(JwtProperties properties) {
        byte[] secret = properties.secret() == null ? new byte[0] : properties.secret().getBytes(StandardCharsets.UTF_8);
        if (secret.length < 32) {
            throw new IllegalStateException("JWT_SECRET은 32바이트 이상이어야 합니다.");
        }
        this.key = Keys.hmacShaKeyFor(secret);
        this.accessTokenExpiration = properties.accessTokenExpiration();
        this.refreshTokenExpiration = properties.refreshTokenExpiration();
    }

    public static Optional<String> resolveBearerToken(String authorizationHeader) {
        if (authorizationHeader == null || !authorizationHeader.startsWith(BEARER_PREFIX)) {
            return Optional.empty();
        }
        String token = authorizationHeader.substring(BEARER_PREFIX.length()).trim();
        return token.isEmpty() ? Optional.empty() : Optional.of(token);
    }

    public String createAccessToken(Long userId, Role role, String sid) {
        Instant now = Instant.now();
        return Jwts.builder()
                .subject(String.valueOf(userId))
                .claim(CLAIM_ROLE, role.name())
                .claim(CLAIM_SID, sid)
                .claim(CLAIM_TYPE, TYPE_ACCESS)
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(accessTokenExpiration)))
                .signWith(key)
                .compact();
    }

    public String createRefreshToken(Long userId, String sid) {
        Instant now = Instant.now();
        return Jwts.builder()
                .id(UUID.randomUUID().toString()) // 같은 초에 다시 발급해도 토큰이 달라지게 한다 (rotation 확인용)
                .subject(String.valueOf(userId))
                .claim(CLAIM_SID, sid)
                .claim(CLAIM_TYPE, TYPE_REFRESH)
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(refreshTokenExpiration)))
                .signWith(key)
                .compact();
    }

    /**
     * @throws io.jsonwebtoken.ExpiredJwtException 만료된 토큰
     * @throws JwtException                         서명·형식이 잘못됐거나 RefreshToken을 넣은 경우
     */
    public JwtClaims parseAccessToken(String token) {
        return toJwtClaims(parse(token, TYPE_ACCESS), true);
    }

    /**
     * @throws JwtException 만료·서명 오류·형식 오류이거나 AccessToken을 넣은 경우
     */
    public JwtClaims parseRefreshToken(String token) {
        return toJwtClaims(parse(token, TYPE_REFRESH), false);
    }

    public Duration getAccessTokenExpiration() {
        return accessTokenExpiration;
    }

    public Duration getRefreshTokenExpiration() {
        return refreshTokenExpiration;
    }

    private Claims parse(String token, String expectedType) {
        Claims claims;
        try {
            claims = Jwts.parser()
                    .verifyWith(key)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();
        } catch (IllegalArgumentException e) {
            throw new JwtException("토큰이 비어 있습니다.", e);
        }
        if (!expectedType.equals(claims.get(CLAIM_TYPE, String.class))) {
            throw new JwtException("토큰 종류가 맞지 않습니다.");
        }
        return claims;
    }

    private JwtClaims toJwtClaims(Claims claims, boolean withRole) {
        try {
            return new JwtClaims(
                    Long.valueOf(claims.getSubject()),
                    claims.get(CLAIM_SID, String.class),
                    withRole ? Role.valueOf(claims.get(CLAIM_ROLE, String.class)) : null,
                    claims.getExpiration().toInstant()
            );
        } catch (RuntimeException e) {
            throw new JwtException("토큰 내용이 올바르지 않습니다.", e);
        }
    }
}
