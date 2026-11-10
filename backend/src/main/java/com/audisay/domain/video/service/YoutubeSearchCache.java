package com.audisay.domain.video.service;

import com.audisay.global.external.youtube.YoutubeVideo;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * 유튜브 검색 결과 캐시. search.list는 100 유닛이라 하루 약 100번밖에 못 부르므로 같은 검색어는 6시간 동안 다시 부르지 않는다.
 * 키는 youtube:search:{pageToken}:{검색어}. 해설 여부는 바뀌므로 캐시하지 않는다. 빈 결과도 캐시하지 않는다(호출하는 쪽에서 거른다).
 * 검색어는 공백을 하나로 줄이고 소문자로 바꿔 키를 만든다("BTS  노래"와 "bts 노래"는 같은 결과를 쓴다).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class YoutubeSearchCache {
    private static final String KEY_PREFIX = "youtube:search:";
    private static final Duration TTL = Duration.ofHours(6);
    private static final Pattern WHITESPACE = Pattern.compile("\\s+");

    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;

    public Optional<CachedPage> get(String query, String pageToken) {
        String json = redisTemplate.opsForValue().get(key(query, pageToken));
        if (json == null) {
            return Optional.empty();
        }
        try {
            return Optional.of(objectMapper.readValue(json, CachedPage.class));
        } catch (JacksonException e) {
            log.warn("[YouTube] 검색 캐시를 읽지 못해 다시 검색합니다 - {}", e.getMessage());
            return Optional.empty();
        }
    }

    public void put(String query, String pageToken, CachedPage page) {
        redisTemplate.opsForValue().set(key(query, pageToken), objectMapper.writeValueAsString(page), TTL);
    }

    private String key(String query, String pageToken) {
        String normalized = WHITESPACE.matcher(query.strip()).replaceAll(" ").toLowerCase(Locale.ROOT);
        return KEY_PREFIX + (pageToken == null ? "" : pageToken) + ":" + normalized;
    }

    public record CachedPage(List<YoutubeVideo> videos, String nextPageToken) {
    }
}
