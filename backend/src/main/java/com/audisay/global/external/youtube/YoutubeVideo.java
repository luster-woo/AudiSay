package com.audisay.global.external.youtube;

import com.fasterxml.jackson.annotation.JsonIgnore;

/**
 * videos.list로 받은 영상 정보 중 필요한 것만.
 *
 * @param privacyStatus  public / unlisted / private
 * @param ageRestricted  연령 제한(contentRating.ytRating = ytAgeRestricted)
 * @param live           실시간 방송이거나 예정된 방송
 */
public record YoutubeVideo(
        String id,
        String title,
        String channelTitle,
        String thumbnailUrl,
        int durationSec,
        String privacyStatus,
        boolean embeddable,
        boolean ageRestricted,
        boolean live
) {
    @JsonIgnore
    public boolean isPrivate() {
        return "private".equals(privacyStatus);
    }
}
