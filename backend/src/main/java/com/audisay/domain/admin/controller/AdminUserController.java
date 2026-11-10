package com.audisay.domain.admin.controller;

import com.audisay.domain.admin.dto.response.AdminUserResponse;
import com.audisay.domain.admin.service.AdminUserService;
import com.audisay.domain.user.entity.Role;
import com.audisay.global.request.PageParams;
import com.audisay.global.response.ApiResponse;
import com.audisay.global.response.PageResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import com.audisay.domain.admin.dto.request.AdminUserSort;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "관리자")
@RestController
@RequestMapping("/v1/admin/users")
@RequiredArgsConstructor
public class AdminUserController {
    private final AdminUserService adminUserService;

    @Operation(summary = "회원 목록 조회", description = "기본 가입 최신순(sort로 바꿈). 역할로 거르고 이메일·이름 일부로 찾는다. 기본은 탈퇴 회원 제외")
    @GetMapping
    public ApiResponse<PageResponse<AdminUserResponse>> getUsers(
            @Parameter(description = "비우면 전체 역할") @RequestParam(value = "role", required = false) Role role,
            @Parameter(description = "이메일 또는 이름 일부") @RequestParam(value = "keyword", required = false) String keyword,
            @RequestParam(value = "includeWithdrawn", defaultValue = "false") boolean includeWithdrawn,
            @Parameter(description = "NEWEST(가입 최신순, 기본) · OLDEST · NAME(이름 가나다순)")
            @RequestParam(value = "sort", defaultValue = "NEWEST") AdminUserSort sort,
            @Valid @ModelAttribute PageParams pageParams) {
        Pageable pageable = pageParams.toPageable();
        return ApiResponse.success("회원 목록 조회 성공", adminUserService.getUsers(role, keyword, includeWithdrawn,
                PageRequest.of(pageable.getPageNumber(), pageable.getPageSize(), sort.sort())));
    }
}
