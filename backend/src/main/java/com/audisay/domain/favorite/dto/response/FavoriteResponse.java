package com.audisay.domain.favorite.dto.response;

public record FavoriteResponse(Long videoId, boolean isFavorite) {
    public static FavoriteResponse added(Long videoId) {
        return new FavoriteResponse(videoId, true);
    }

    public static FavoriteResponse removed(Long videoId) {
        return new FavoriteResponse(videoId, false);
    }
}
