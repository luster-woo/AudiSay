package com.audisay.domain.favorite.service;

import com.audisay.domain.favorite.dto.response.FavoriteResponse;
import com.audisay.domain.favorite.dto.response.FavoriteVideoResponse;
import com.audisay.domain.favorite.entity.Favorite;
import com.audisay.domain.favorite.repository.FavoriteRepository;
import com.audisay.domain.video.entity.Video;
import com.audisay.domain.video.repository.VideoRepository;
import com.audisay.domain.video.service.DescriptionState;
import com.audisay.domain.video.service.DescriptionStateReader;
import com.audisay.domain.video.service.VideoService;
import com.audisay.global.response.PageResponse;
import com.audisay.global.security.AuthUser;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class FavoriteService {
    private final FavoriteRepository favoriteRepository;
    private final VideoRepository videoRepository;
    private final VideoService videoService;
    private final DescriptionStateReader descriptionStateReader;

    /**
     * 즐겨찾기에 넣은 영상. 최근에 넣은 순
     * 유튜브 공개 여부는 여기서 확인하지 않고, 재생하거나 다시 요청할 때 확인해 바뀐 상태(UNAVAILABLE)를 쓴다.
     */
    @Transactional(readOnly = true)
    public PageResponse<FavoriteVideoResponse> getFavorites(AuthUser authUser, Pageable pageable) {
        Page<Favorite> favorites = favoriteRepository.findLatestByUserId(authUser.userId(), pageable);
        List<Long> videoIds = favorites.map(Favorite::getVideoId).getContent();
        Map<Long, Video> videos = videoRepository.findAllById(videoIds).stream()
                .collect(Collectors.toMap(Video::getId, Function.identity()));
        Map<Long, DescriptionState> states = descriptionStateReader.readAll(videoIds);
        return PageResponse.from(favorites.map(favorite -> {
            Video video = videos.get(favorite.getVideoId());
            boolean available = video.isAvailable() && video.isViewableBy(authUser.userId(), authUser.role());
            return FavoriteVideoResponse.of(video, states.get(video.getId()).descriptionId() != null,
                    available, favorite.getCreatedAt());
        }));
    }

    /**
     * 이미 넣은 영상이면 그대로 성공한다(멱등). 볼 수 없는 영상(남의 비공개 업로드)은 넣을 수 없다.
     */
    @Transactional
    public FavoriteResponse add(AuthUser authUser, Long videoId) {
        videoService.getAccessibleVideo(authUser, videoId);
        favoriteRepository.insertIfAbsent(authUser.userId(), videoId);
        return FavoriteResponse.added(videoId);
    }

    /**
     * 즐겨찾기에 없거나 볼 수 없는 영상이어도 그대로 성공한다(멱등).
     */
    @Transactional
    public FavoriteResponse remove(Long userId, Long videoId) {
        favoriteRepository.deleteByUserIdAndVideoId(userId, videoId);
        return FavoriteResponse.removed(videoId);
    }
}
