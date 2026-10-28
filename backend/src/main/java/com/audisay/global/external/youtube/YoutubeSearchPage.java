package com.audisay.global.external.youtube;

import java.util.List;

/**
 * search.list 결과. 영상 ID만 유튜브 순서대로 담는다.
 *
 * @param nextPageToken 다음 결과가 없으면 null
 */
public record YoutubeSearchPage(List<String> videoIds, String nextPageToken) {
}
