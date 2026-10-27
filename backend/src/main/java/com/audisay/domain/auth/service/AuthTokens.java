package com.audisay.domain.auth.service;

/**
 * 서비스가 컨트롤러에 넘기는 결과. body는 응답 본문, refreshToken은 컨트롤러가 쿠키로 내려보낸다.
 */
public record AuthTokens<T>(T body, String refreshToken) {
}
