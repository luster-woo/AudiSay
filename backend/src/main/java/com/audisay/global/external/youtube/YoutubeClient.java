package com.audisay.global.external.youtube;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

import java.net.http.HttpClient;
import java.time.Duration;
import java.time.format.DateTimeParseException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Supplier;

/**
 * YouTube Data API v3. 하루 한도는 10,000 유닛이고 videos.list는 1, search.list는 100 유닛이다.
 * API 키는 URL에 남지 않도록 헤더(X-goog-api-key)로 보낸다.
 */
@Slf4j
@Component
public class YoutubeClient {
    private static final String API_KEY_HEADER = "X-goog-api-key";
    private static final int SEARCH_PAGE_SIZE = 10;

    private final RestClient restClient;
    private final String apiKey;

    public YoutubeClient(YoutubeProperties properties) {
        HttpClient httpClient = HttpClient.newBuilder().connectTimeout(properties.connectTimeout()).build();
        JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(httpClient);
        requestFactory.setReadTimeout(properties.readTimeout());
        this.restClient = RestClient.builder()
                .baseUrl(properties.baseUrl())
                .requestFactory(requestFactory)
                .build();
        this.apiKey = properties.apiKey();
    }

    /**
     * 영상 하나. 없거나 다른 사람의 비공개 영상이면 비어 있다(유튜브가 결과에서 뺀다).
     */
    public Optional<YoutubeVideo> getVideo(String videoId) {
        return getVideos(List.of(videoId)).stream().findFirst();
    }

    /**
     * 여러 영상을 한 번에(최대 50개). 찾지 못한 영상은 빠지고 순서는 유튜브가 준 대로다.
     */
    public List<YoutubeVideo> getVideos(List<String> videoIds) {
        if (videoIds.isEmpty()) {
            return List.of();
        }
        VideoListResponse response = call("videos.list", () -> restClient.get()
                .uri(uri -> uri.path("/videos")
                        .queryParam("part", "snippet,contentDetails,status")
                        .queryParam("id", "{ids}")
                        .build(Map.of("ids", String.join(",", videoIds))))
                .header(API_KEY_HEADER, requireApiKey())
                .retrieve()
                .body(VideoListResponse.class));
        if (response == null || response.items() == null) {
            return List.of();
        }
        return response.items().stream().map(VideoItem::toYoutubeVideo).toList();
    }

    /**
     * 퍼가기를 허용한 영상만 한국 기준으로 10개씩 찾는다.
     */
    public YoutubeSearchPage search(String query, String pageToken) {
        Map<String, String> variables = new HashMap<>();
        variables.put("q", query);
        variables.put("pageToken", pageToken);
        SearchListResponse response = call("search.list", () -> restClient.get()
                .uri(uri -> {
                    uri.path("/search")
                            .queryParam("part", "id")
                            .queryParam("type", "video")
                            .queryParam("videoEmbeddable", "true")
                            .queryParam("regionCode", "KR")
                            .queryParam("relevanceLanguage", "ko")
                            .queryParam("maxResults", SEARCH_PAGE_SIZE)
                            .queryParam("q", "{q}");
                    if (StringUtils.hasText(pageToken)) {
                        uri.queryParam("pageToken", "{pageToken}");
                    }
                    return uri.build(variables);
                })
                .header(API_KEY_HEADER, requireApiKey())
                .retrieve()
                .body(SearchListResponse.class));
        if (response == null || response.items() == null) {
            return new YoutubeSearchPage(List.of(), null);
        }
        List<String> videoIds = response.items().stream()
                .map(SearchItem::id)
                .filter(id -> id != null && id.videoId() != null)
                .map(SearchItemId::videoId)
                .toList();
        return new YoutubeSearchPage(videoIds, response.nextPageToken());
    }

    private <T> T call(String operation, Supplier<T> request) {
        try {
            return request.get();
        } catch (RestClientResponseException e) {
            boolean quotaExceeded = e.getResponseBodyAsString().contains("quotaExceeded");
            log.warn("[YouTube] {} 실패 - status={}, quotaExceeded={}", operation, e.getStatusCode().value(), quotaExceeded);
            throw new YoutubeApiException("YouTube " + operation + " 실패: " + e.getStatusCode().value(), quotaExceeded, e);
        } catch (RestClientException e) {
            log.warn("[YouTube] {} 실패 - {}", operation, e.getClass().getSimpleName());
            throw new YoutubeApiException("YouTube " + operation + " 실패", false, e);
        }
    }

    private String requireApiKey() {
        if (!StringUtils.hasText(apiKey)) {
            throw new YoutubeApiException("YOUTUBE_API_KEY가 설정되지 않았습니다.", false, null);
        }
        return apiKey;
    }

    /** ISO 8601 길이(PT1H2M3S). 실시간 방송은 P0D라 0이다 */
    private static int parseDurationSec(String isoDuration) {
        if (isoDuration == null) {
            return 0;
        }
        try {
            return (int) Duration.parse(isoDuration).toSeconds();
        } catch (DateTimeParseException e) {
            return 0;
        }
    }

    // ===== YouTube 응답 (필요한 필드만) =====

    @JsonIgnoreProperties(ignoreUnknown = true)
    record VideoListResponse(List<VideoItem> items) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record VideoItem(String id, Snippet snippet, ContentDetails contentDetails, Status status) {
        YoutubeVideo toYoutubeVideo() {
            Snippet s = snippet != null ? snippet : new Snippet(null, null, null, null);
            ContentDetails c = contentDetails != null ? contentDetails : new ContentDetails(null, null);
            Status st = status != null ? status : new Status(null, null);
            return new YoutubeVideo(
                    id,
                    s.title(),
                    s.channelTitle(),
                    s.thumbnailUrl(),
                    parseDurationSec(c.duration()),
                    st.privacyStatus(),
                    Boolean.TRUE.equals(st.embeddable()),
                    c.contentRating() != null && "ytAgeRestricted".equals(c.contentRating().ytRating()),
                    "live".equals(s.liveBroadcastContent()) || "upcoming".equals(s.liveBroadcastContent())
            );
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Snippet(String title, String channelTitle, Map<String, Thumbnail> thumbnails, String liveBroadcastContent) {
        /** hqdefault(high)를 먼저 쓴다 */
        String thumbnailUrl() {
            if (thumbnails == null) {
                return null;
            }
            for (String size : List.of("high", "medium", "default")) {
                Thumbnail thumbnail = thumbnails.get(size);
                if (thumbnail != null && thumbnail.url() != null) {
                    return thumbnail.url();
                }
            }
            return null;
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Thumbnail(String url) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record ContentDetails(String duration, ContentRating contentRating) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record ContentRating(String ytRating) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Status(String privacyStatus, Boolean embeddable) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record SearchListResponse(List<SearchItem> items, String nextPageToken) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record SearchItem(SearchItemId id) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record SearchItemId(String videoId) {
    }
}
