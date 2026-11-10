package com.audisay.domain.admin.service;

import com.audisay.domain.admin.dto.response.RegenerateResponse;
import com.audisay.domain.job.entity.Job;
import com.audisay.domain.job.entity.JobType;
import com.audisay.domain.job.service.JobLauncher;
import com.audisay.domain.user.entity.User;
import com.audisay.domain.user.service.UserService;
import com.audisay.domain.video.entity.Video;
import com.audisay.domain.video.repository.VideoRepository;
import com.audisay.domain.video.service.DescriptionStateReader;
import com.audisay.domain.video.service.PreparePayloadFactory;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class AdminVideoService {
    private final VideoRepository videoRepository;
    private final UserService userService;
    private final DescriptionStateReader descriptionStateReader;
    private final PreparePayloadFactory preparePayloadFactory;
    private final JobLauncher jobLauncher;

    /**
     * 영상 해설 전체를 AI로 다시 만든다(REGENERATE 작업). 완성되기 전까지 지금 공개 해설을 계속 재생하고,
     * 완성되면 작업 완료 처리에서 기존 해설은 ARCHIVED, 새 해설은 PUBLISHED가 된다.
     * 관리자는 이용 횟수가 없어 요청 기록(generation_requests)을 남기지 않는다.
     */
    @Transactional
    public RegenerateResponse regenerate(Long adminId, Long videoId) {
        Video video = videoRepository.findById(videoId)
                .orElseThrow(() -> new BusinessException(ErrorCode.VIDEO_NOT_FOUND));
        User admin = userService.getActiveUser(adminId);
        Long currentDescriptionId = descriptionStateReader.read(videoId).descriptionId();
        // 다시 만들기는 예전 Gemini 결과(캐시)를 쓰지 않는다 (같은 해설이 나오지 않게)
        Job job = jobLauncher.launch(video, admin, JobType.REGENERATE, preparePayloadFactory.create(video).regenerate());
        return new RegenerateResponse(videoId, job.getId(), job.getJobType(), currentDescriptionId);
    }
}
