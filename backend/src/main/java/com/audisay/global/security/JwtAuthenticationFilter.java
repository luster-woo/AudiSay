package com.audisay.global.security;

import com.audisay.global.exception.ErrorCode;
import io.jsonwebtoken.ExpiredJwtException;
import io.jsonwebtoken.JwtException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;

/**
 * Bearer 토큰을 검증해 SecurityContext에 {@link AuthUser}를 넣는다.
 * 토큰이 잘못돼도 여기서 응답하지 않고 이유만 남긴다. 인증이 필요한 주소면 EntryPoint가 그 이유로 401을 보낸다.
 * 서블릿 필터로 한 번 더 등록되지 않도록 빈으로 만들지 않고 SecurityConfig에서 생성한다.
 */
@RequiredArgsConstructor
public class JwtAuthenticationFilter extends OncePerRequestFilter {
    public static final String AUTH_ERROR_ATTRIBUTE = JwtAuthenticationFilter.class.getName() + ".AUTH_ERROR";

    private final JwtProvider jwtProvider;
    private final AccessTokenBlacklist blacklist;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        JwtProvider.resolveBearerToken(request.getHeader(HttpHeaders.AUTHORIZATION))
                .ifPresent(token -> authenticate(token, request));
        filterChain.doFilter(request, response);
    }

    private void authenticate(String token, HttpServletRequest request) {
        try {
            JwtClaims claims = jwtProvider.parseAccessToken(token);
            if (blacklist.contains(claims.sid())) {
                request.setAttribute(AUTH_ERROR_ATTRIBUTE, ErrorCode.UNAUTHORIZED);
                return;
            }
            AuthUser authUser = claims.toAuthUser();
            UsernamePasswordAuthenticationToken authentication = new UsernamePasswordAuthenticationToken(
                    authUser, null, List.of(new SimpleGrantedAuthority("ROLE_" + authUser.role().name())));
            SecurityContextHolder.getContext().setAuthentication(authentication);
        } catch (ExpiredJwtException e) {
            request.setAttribute(AUTH_ERROR_ATTRIBUTE, ErrorCode.ACCESS_TOKEN_EXPIRED);
        } catch (JwtException e) {
            request.setAttribute(AUTH_ERROR_ATTRIBUTE, ErrorCode.UNAUTHORIZED);
        }
    }
}
