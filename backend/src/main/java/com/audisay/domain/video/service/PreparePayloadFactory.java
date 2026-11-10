package com.audisay.domain.video.service;

import com.audisay.domain.job.message.payload.PreparePayload;
import com.audisay.domain.video.entity.SourceType;
import com.audisay.domain.video.entity.Video;
import com.audisay.domain.video.entity.VideoUpload;
import com.audisay.domain.video.repository.VideoUploadRepository;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import com.audisay.global.external.s3.S3StorageClient;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 이미 등록된 영상의 해설을 다시 만들 때 첫 단계(job.prepare) 메시지를 만든다. 해설 다시 요청과 해설 다시 만들기가 쓴다.
 * 유튜브는 영상 주소를, 업로드는 S3에 남아 있는 파일을 넘긴다.
 */
@Component
@RequiredArgsConstructor
public class PreparePayloadFactory {
    private static final String YOUTUBE_WATCH_URL = "https://www.youtube.com/watch?v=";

    private final VideoUploadRepository videoUploadRepository;
    private final S3StorageClient s3StorageClient;

    public static PreparePayload youtube(Video video) {
        return PreparePayload.youtube(video.getId(), YOUTUBE_WATCH_URL + video.getYoutubeVideoId(),
                video.getDurationSec(), video.getTitle());
    }

    /**
     * 업로드 원본이 수명 주기 규칙으로 지워졌으면 재생용 파일로 다시 분석한다. 둘 다 없으면 JOB_003.
     */
    public PreparePayload create(Video video) {
        if (video.getSourceType() == SourceType.YOUTUBE) {
            return youtube(video);
        }
        VideoUpload upload = videoUploadRepository.findById(video.getId())
                .orElseThrow(() -> new BusinessException(ErrorCode.JOB_NOT_RETRYABLE));
        return PreparePayload.upload(video.getId(), sourceKey(upload), video.getDurationSec(), video.getTitle());
    }

    private String sourceKey(VideoUpload upload) {
        if (s3StorageClient.exists(upload.getOriginalKey())) {
            return upload.getOriginalKey();
        }
        if (upload.getPlaybackKey() != null && s3StorageClient.exists(upload.getPlaybackKey())) {
            return upload.getPlaybackKey();
        }
        throw new BusinessException(ErrorCode.JOB_NOT_RETRYABLE, "분석할 영상 파일이 남아 있지 않아 다시 만들 수 없어요.");
    }
}
