package com.audisay.domain.favorite.controller;

import com.audisay.domain.favorite.dto.response.FavoriteResponse;
import com.audisay.domain.favorite.dto.response.FavoriteVideoResponse;
import com.audisay.domain.favorite.service.FavoriteService;
import com.audisay.global.request.PageParams;
import com.audisay.global.response.ApiResponse;
import com.audisay.global.response.PageResponse;
import com.audisay.global.security.AuthUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "즐겨찾기")
@RestController
@RequestMapping("/v1/favorites")
@RequiredArgsConstructor
public class FavoriteController {
    private final FavoriteService favoriteService;

    @Operation(summary = "즐겨찾기 목록", description = "최근에 넣은 순. 볼 수 없는 영상은 available false")
    @GetMapping
    public ApiResponse<PageResponse<FavoriteVideoResponse>> getFavorites(@AuthenticationPrincipal AuthUser authUser,
                                                                         @Valid @ModelAttribute PageParams pageParams) {
        return ApiResponse.success("즐겨찾기 조회 성공", favoriteService.getFavorites(authUser, pageParams.toPageable()));
    }

    @Operation(summary = "즐겨찾기 추가", description = "이미 넣은 영상이면 그대로 성공한다")
    @PostMapping("/{videoId}")
    public ApiResponse<FavoriteResponse> addFavorite(@AuthenticationPrincipal AuthUser authUser,
                                                     @PathVariable("videoId") Long videoId) {
        return ApiResponse.success("즐겨찾기에 추가했습니다.", favoriteService.add(authUser, videoId));
    }

    @Operation(summary = "즐겨찾기 삭제", description = "즐겨찾기에 없는 영상이어도 그대로 성공한다")
    @DeleteMapping("/{videoId}")
    public ApiResponse<FavoriteResponse> removeFavorite(@AuthenticationPrincipal AuthUser authUser,
                                                        @PathVariable("videoId") Long videoId) {
        return ApiResponse.success("즐겨찾기에서 뺐습니다.", favoriteService.remove(authUser.userId(), videoId));
    }
}
