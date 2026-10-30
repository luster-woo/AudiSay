package com.audisay.domain.video.service;

import com.audisay.domain.user.entity.Role;
import com.audisay.domain.user.service.UserService;
import com.audisay.domain.video.dto.request.YoutubeSearchRequest;
import com.audisay.domain.video.dto.response.YoutubeCheckResponse;
import com.audisay.domain.video.dto.response.YoutubeRejectReason;
import com.audisay.domain.video.dto.response.YoutubeSearchResponse;
import com.audisay.domain.video.entity.Video;
import com.audisay.domain.video.repository.VideoRepository;
import com.audisay.global.config.UsageLimitProperties;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import com.audisay.global.external.youtube.YoutubeApiException;
import com.audisay.global.external.youtube.YoutubeClient;
import com.audisay.global.external.youtube.YoutubeVideo;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class YoutubeVideoService {
    private final YoutubeClient youtubeClient;
    private final YoutubeSearchCache youtubeSearchCache;
    private final VideoRepository videoRepository;
    private final DescriptionStateReader descriptionStateReader;
    private final UserService userService;
    private final UsageLimitProperties usageLimitProperties;

    /**
     * 해설을 만들 수 있는 영상인지 확인만 한다. 조건이 안 맞아도 예외 없이 rejectReason으로 알려 준다.
     * 길이 제한이 역할마다 달라 결과를 저장하지 않고 요청할 때마다 다시 확인한다.
     */
    @Transactional(readOnly = true)
    public YoutubeCheckResponse check(Long userId, String url) {
        String youtubeVideoId = YoutubeUrlParser.extractVideoId(url);
        Role role = userService.getActiveUser(userId).getRole();

        Optional<Video> registered = videoRepository.findByYoutubeVideoId(youtubeVideoId);
        DescriptionState state = registered
                .map(video -> descriptionStateReader.read(video.getId()))
                .orElse(DescriptionState.NONE);
        Long videoId = registered.map(Video::getId).orElse(null);

        Optional<YoutubeVideo> found = youtubeClient.getVideo(youtubeVideoId);
        if (found.isEmpty()) {
            return new YoutubeCheckResponse(youtubeVideoId, null, null, null, null,
                    false, YoutubeRejectReason.NOT_FOUND, videoId, state.status(), false);
        }

        YoutubeVideo video = found.get();
        YoutubeRejectReason rejectReason = rejectReason(video, role);
        boolean available = rejectReason == null;
        // 해설이 있거나 만드는 중이면 재사용·합류라 차감하지 않고, 실패한 영상은 다시 요청 API(차감 없음)를 쓴다
        boolean willCount = available && state.status() == VideoDescriptionStatus.NONE;
        return new YoutubeCheckResponse(youtubeVideoId, video.title(), video.channelTitle(), video.thumbnailUrl(),
                video.durationSec(), available, rejectReason, videoId, state.status(), willCount);
    }

    /**
     * 해설이 있는 영상을 앞에 두고, 같은 그룹 안에서는 유튜브 순서를 지킨다.
     * 유튜브 결과는 캐시하고 해설 여부는 매번 DB에서 붙인다.
     */
    @Transactional(readOnly = true)
    public YoutubeSearchResponse search(YoutubeSearchRequest request) {
        String query = request.q().strip();
        YoutubeSearchCache.CachedPage page = youtubeSearchCache.get(query, request.pageToken())
                .orElseGet(() -> {
                    YoutubeSearchCache.CachedPage fetched = fetchSearchPage(query, request.pageToken());
                    youtubeSearchCache.put(query, request.pageToken(), fetched);
                    return fetched;
                });

        List<String> youtubeIds = page.videos().stream().map(YoutubeVideo::id).toList();
        Map<String, Video> registered = youtubeIds.isEmpty() ? Map.of()
                : videoRepository.findByYoutubeVideoIdIn(youtubeIds).stream()
                .collect(Collectors.toMap(Video::getYoutubeVideoId, Function.identity()));
        Map<Long, DescriptionState> states = descriptionStateReader.readAll(
                registered.values().stream().map(Video::getId).toList());

        List<YoutubeSearchResponse.Item> items = page.videos().stream()
                .map(video -> {
                    Video saved = registered.get(video.id());
                    boolean hasDescription = saved != null
                            && states.get(saved.getId()).status() == VideoDescriptionStatus.READY;
                    return new YoutubeSearchResponse.Item(video.id(), video.title(), video.channelTitle(),
                            video.thumbnailUrl(), video.durationSec(), hasDescription,
                            saved != null ? saved.getId() : null);
                })
                .sorted(Comparator.comparing(item -> !item.hasDescription()))
                .toList();
        return new YoutubeSearchResponse(items, page.nextPageToken());
    }

    private YoutubeSearchCache.CachedPage fetchSearchPage(String query, String pageToken) {
        try {
            var searchPage = youtubeClient.search(query, pageToken);
            // search.list에는 길이가 없어 videos.list로 다시 조회한다(1 유닛). 순서는 검색 결과를 따른다
            Map<String, YoutubeVideo> details = youtubeClient.getVideos(searchPage.videoIds()).stream()
                    .collect(Collectors.toMap(YoutubeVideo::id, Function.identity(), (a, b) -> a));
            List<YoutubeVideo> videos = searchPage.videoIds().stream()
                    .map(details::get)
                    .filter(video -> video != null && !video.live())
                    .toList();
            return new YoutubeSearchCache.CachedPage(videos, searchPage.nextPageToken());
        } catch (YoutubeApiException e) {
            throw new BusinessException(ErrorCode.YOUTUBE_SEARCH_UNAVAILABLE);
        }
    }

    /** 먼저 걸리는 이유 하나. 통과하면 null. 유튜브 해설 요청도 같은 규칙을 쓴다 */
    YoutubeRejectReason rejectReason(YoutubeVideo video, Role role) {
        if (video.isPrivate()) {
            return YoutubeRejectReason.PRIVATE;
        }
        if (video.live()) {
            return YoutubeRejectReason.LIVE;
        }
        if (video.ageRestricted()) {
            return YoutubeRejectReason.AGE_RESTRICTED;
        }
        if (!video.embeddable()) {
            return YoutubeRejectReason.NOT_EMBEDDABLE;
        }
        boolean tooLong = usageLimitProperties.forRole(role)
                .map(limit -> video.durationSec() > limit.youtube().maxDurationSec())
                .orElse(false);
        return tooLong ? YoutubeRejectReason.TOO_LONG : null;
    }
}
