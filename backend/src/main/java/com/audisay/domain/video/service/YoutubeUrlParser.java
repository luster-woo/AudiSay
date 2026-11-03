package com.audisay.domain.video.service;

import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * 유튜브 링크에서 11자리 영상 ID를 떼어 낸다.
 * watch?v=, youtu.be/, shorts/, embed/, live/ 형식과 m.·www.·music. 주소, 스킴(https://)이 빠진 링크를 받는다.
 */
public final class YoutubeUrlParser {
    private static final Pattern VIDEO_ID = Pattern.compile("^[A-Za-z0-9_-]{11}$");
    private static final List<String> PATH_PREFIXES = List.of("/shorts/", "/embed/", "/live/", "/v/");

    private YoutubeUrlParser() {
    }

    public static String extractVideoId(String url) {
        String videoId = parse(url == null ? "" : url.strip());
        if (videoId == null || !VIDEO_ID.matcher(videoId).matches()) {
            throw new BusinessException(ErrorCode.INVALID_YOUTUBE_URL);
        }
        return videoId;
    }

    private static String parse(String url) {
        URI uri;
        try {
            uri = new URI(url.contains("://") ? url : "https://" + url);
        } catch (URISyntaxException e) {
            return null;
        }
        if (uri.getHost() == null || uri.getPath() == null) {
            return null;
        }
        String host = uri.getHost().toLowerCase(Locale.ROOT).replaceFirst("^(www|m|music)\\.", "");
        String path = uri.getPath();

        if (host.equals("youtu.be")) {
            // "youtu.be"처럼 경로가 아예 없으면 path가 빈 문자열이다
            return path.isEmpty() ? null : firstSegment(path.substring(1));
        }
        if (!host.equals("youtube.com") && !host.equals("youtube-nocookie.com")) {
            return null;
        }
        if (path.equals("/watch") || path.equals("/watch/")) {
            return queryParam(uri.getRawQuery(), "v");
        }
        for (String prefix : PATH_PREFIXES) {
            if (path.startsWith(prefix)) {
                return firstSegment(path.substring(prefix.length()));
            }
        }
        return null;
    }

    private static String firstSegment(String path) {
        int slash = path.indexOf('/');
        return slash < 0 ? path : path.substring(0, slash);
    }

    private static String queryParam(String query, String name) {
        if (query == null) {
            return null;
        }
        for (String pair : query.split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0 && pair.substring(0, eq).equals(name)) {
                return pair.substring(eq + 1);
            }
        }
        return null;
    }
}
