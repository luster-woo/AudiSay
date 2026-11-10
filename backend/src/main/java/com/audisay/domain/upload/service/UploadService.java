package com.audisay.domain.upload.service;

import com.audisay.domain.job.entity.Job;
import com.audisay.domain.job.entity.JobType;
import com.audisay.domain.job.message.payload.PreparePayload;
import com.audisay.domain.job.service.JobLauncher;
import com.audisay.domain.upload.dto.request.PartUrlRequest;
import com.audisay.domain.upload.dto.request.UploadCompleteRequest;
import com.audisay.domain.upload.dto.request.UploadStartRequest;
import com.audisay.domain.upload.dto.response.PartUrlResponse;
import com.audisay.domain.upload.dto.response.PartUrlResponse.PartUrl;
import com.audisay.domain.upload.dto.response.UploadCompleteResponse;
import com.audisay.domain.upload.dto.response.UploadStartResponse;
import com.audisay.domain.user.entity.User;
import com.audisay.domain.user.service.UserService;
import com.audisay.domain.video.entity.GenerationRequest;
import com.audisay.domain.video.entity.GenerationResult;
import com.audisay.domain.video.entity.SourceType;
import com.audisay.domain.video.entity.UploadStatus;
import com.audisay.domain.video.entity.Video;
import com.audisay.domain.video.entity.VideoFormat;
import com.audisay.domain.video.entity.VideoUpload;
import com.audisay.domain.video.entity.Visibility;
import com.audisay.domain.video.repository.GenerationRequestRepository;
import com.audisay.domain.video.repository.VideoRepository;
import com.audisay.domain.video.repository.VideoUploadRepository;
import com.audisay.domain.video.service.GenerationRequestService;
import com.audisay.global.config.UsageLimitProperties;
import com.audisay.global.config.UsageLimitProperties.RoleLimit;
import com.audisay.global.config.UsageLimitProperties.UploadLimit;
import com.audisay.global.exception.BusinessException;
import com.audisay.global.exception.ErrorCode;
import com.audisay.global.external.s3.S3Properties;
import com.audisay.global.external.s3.S3StorageClient;
import com.audisay.global.external.s3.S3StorageClient.PresignedUrl;
import com.audisay.global.external.s3.S3StorageClient.UploadedPart;
import com.audisay.global.external.s3.UploadThumbnailStore;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import software.amazon.awssdk.services.s3.model.S3Exception;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * 브라우저가 S3에 직접 올리는 멀티파트 업로드. 시작 → 조각 주소 발급 → (브라우저가 조각 PUT) → 완료.
 * 업로드 횟수는 완료 때 차감한다.
 */
@Service
@RequiredArgsConstructor
public class UploadService {
    static final List<UploadStatus> IN_PROGRESS = List.of(UploadStatus.INITIATED, UploadStatus.UPLOADING);
    /** 이보다 오래 멈춘 업로드는 정리 대상(StaleUploadCleaner)이라 남은 횟수를 잡아 두지 않는다 */
    static final Duration IN_PROGRESS_WINDOW = Duration.ofHours(24);
    /** S3 멀티파트 업로드의 조각 수 상한 */
    private static final int MAX_PART_COUNT = 10_000;
    /** 올린 조각이 요청과 맞지 않을 때 S3 완료 요청이 돌려주는 오류 */
    private static final Set<String> PART_MISMATCH_ERRORS =
            Set.of("InvalidPart", "InvalidPartOrder", "EntityTooSmall", "NoSuchUpload");

    private final UserService userService;
    private final VideoRepository videoRepository;
    private final VideoUploadRepository videoUploadRepository;
    private final GenerationRequestRepository generationRequestRepository;
    private final GenerationRequestService generationRequestService;
    private final JobLauncher jobLauncher;
    private final S3StorageClient s3StorageClient;
    private final S3Properties s3Properties;
    private final UploadThumbnailStore uploadThumbnailStore;
    private final UsageLimitProperties usageLimitProperties;

    /**
     * 사전 검사(저작권 동의·형식·용량·길이·횟수)를 통과하면 영상(UPLOADING)과 업로드(INITIATED)를 만들고
     * S3 멀티파트 업로드를 시작한다. 관리자는 용량·길이·횟수 제한이 없다.
     */
    @Transactional
    public UploadStartResponse start(Long userId, UploadStartRequest request) {
        User user = userService.getActiveUser(userId);
        if (!Boolean.TRUE.equals(request.copyrightAgreed())) {
            throw new BusinessException(ErrorCode.COPYRIGHT_NOT_AGREED);
        }
        VideoFormat format = VideoFormat.fromContentType(request.contentType())
                .orElseThrow(() -> new BusinessException(ErrorCode.UNSUPPORTED_VIDEO_FORMAT));
        long partSize = partSize();
        if (partCount(request.sizeBytes(), partSize) > MAX_PART_COUNT) {
            throw new BusinessException(ErrorCode.FILE_SIZE_EXCEEDED);
        }
        Optional<UploadLimit> limit = usageLimitProperties.forRole(user.getRole()).map(RoleLimit::upload);
        if (limit.isPresent()) {
            checkLimit(userId, request, limit.get());
        }

        Visibility visibility = request.visibility() == null ? Visibility.PRIVATE : request.visibility();
        Video video = videoRepository.save(
                Video.createUpload(user, request.title().strip(), request.durationSec(), visibility));
        String originalKey = "uploads/%d/original.%s".formatted(video.getId(), format.getExtension());
        String s3UploadId = s3StorageClient.createMultipartUpload(originalKey, format.getContentType());
        videoUploadRepository.save(VideoUpload.create(video, originalKey, s3UploadId,
                request.originalFilename().strip(), format, request.sizeBytes()));
        return new UploadStartResponse(video.getId(), partSize, (int) partCount(request.sizeBytes(), partSize));
    }

    /**
     * 요청한 조각 번호마다 presigned PUT 주소를 준다. 첫 발급 때 UPLOADING으로 바꾼다.
     */
    @Transactional
    public PartUrlResponse issuePartUrls(Long userId, Long videoId, PartUrlRequest request) {
        VideoUpload upload = getOwnUpload(userId, videoId, false);
        if (upload.isClosed()) {
            throw new BusinessException(ErrorCode.UPLOAD_ALREADY_CLOSED);
        }
        long partCount = partCount(upload.getSizeBytes(), partSize());
        List<Integer> partNumbers = request.partNumbers().stream().distinct().sorted().toList();
        if (partNumbers.getLast() > partCount) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "조각 번호는 1부터 %d까지예요.".formatted(partCount));
        }

        upload.startUploading();
        List<PartUrl> parts = new ArrayList<>();
        Instant expiresAt = null;
        for (int partNumber : partNumbers) {
            PresignedUrl url = s3StorageClient.presignUploadPart(upload.getOriginalKey(), upload.getS3UploadId(), partNumber);
            parts.add(new PartUrl(partNumber, url.url()));
            if (expiresAt == null || url.expiresAt().isBefore(expiresAt)) {
                expiresAt = url.expiresAt();
            }
        }
        return new PartUrlResponse(parts, expiresAt);
    }

    /**
     * S3 멀티파트 업로드를 마치고 해설 생성 작업(LOCAL)을 만든다. 업로드 횟수는 여기서 차감한다.
     * 조각은 1번부터 마지막 번호까지 빠짐없이 와야 한다.
     */
    @Transactional
    public UploadCompleteResponse complete(Long userId, Long videoId, UploadCompleteRequest request) {
        VideoUpload upload = getOwnUpload(userId, videoId, true);
        if (upload.isClosed()) {
            throw new BusinessException(ErrorCode.UPLOAD_ALREADY_CLOSED);
        }
        List<UploadedPart> parts = request.parts().stream()
                .sorted(Comparator.comparing(UploadCompleteRequest.Part::partNumber))
                .map(part -> new UploadedPart(part.partNumber(), part.eTag()))
                .toList();
        if (!coversAllParts(parts, partCount(upload.getSizeBytes(), partSize()))) {
            throw new BusinessException(ErrorCode.UPLOAD_PART_MISMATCH);
        }
        try {
            s3StorageClient.completeMultipartUpload(upload.getOriginalKey(), upload.getS3UploadId(), parts);
        } catch (S3Exception e) {
            if (e.awsErrorDetails() != null && PART_MISMATCH_ERRORS.contains(e.awsErrorDetails().errorCode())) {
                throw new BusinessException(ErrorCode.UPLOAD_PART_MISMATCH);
            }
            throw e;
        }

        upload.complete(Instant.now());
        Video video = upload.getVideo();
        video.finishUpload();
        User user = userService.getActiveUser(userId);
        Job job = jobLauncher.launch(video, user, JobType.GENERATE, PreparePayload.upload(
                video.getId(), upload.getOriginalKey(), video.getDurationSec(), video.getTitle()));
        LocalDate today = GenerationRequestService.todayKst();
        generationRequestRepository.save(GenerationRequest.newJob(user, video, job.getId(), today));
        return new UploadCompleteResponse(video.getId(), job.getId(), GenerationResult.NEW_JOB, remaining(user, today));
    }

    /**
     * 올라간 조각을 S3에서 지우고 영상 행을 지운다(video_uploads는 함께 지워짐). 완료 전이라 횟수는 차감하지 않는다.
     */
    @Transactional
    public void abort(Long userId, Long videoId) {
        VideoUpload upload = getOwnUpload(userId, videoId, true);
        if (upload.getUploadStatus() == UploadStatus.COMPLETED) {
            throw new BusinessException(ErrorCode.UPLOAD_ALREADY_CLOSED, "이미 완료된 업로드는 취소할 수 없어요.");
        }
        s3StorageClient.abortMultipartUpload(upload.getOriginalKey(), upload.getS3UploadId());
        Video video = upload.getVideo();
        videoUploadRepository.delete(upload);
        videoRepository.delete(video);
    }

    /**
     * 워커가 재생용 파일과 썸네일을 만들었다(LOCAL prepare 완료). 썸네일은 원본과 함께 지워지지 않게 따로 복사해 둔다
     * (UploadThumbnailStore)
     */
    @Transactional
    public void finishTranscode(Long videoId, String playbackKey) {
        videoUploadRepository.findById(videoId).ifPresent(upload -> {
            upload.finishTranscode(playbackKey);
            upload.getVideo().attachUploadThumbnail(uploadThumbnailStore.keep(videoId));
        });
    }

    /** 해설 작업이 실패했다. 재생용 파일을 이미 만들었으면 그대로 둔다 */
    @Transactional
    public void failTranscode(Long videoId) {
        videoUploadRepository.findById(videoId).ifPresent(VideoUpload::failTranscode);
    }

    private void checkLimit(Long userId, UploadStartRequest request, UploadLimit limit) {
        if (request.sizeBytes() > limit.maxSize().toBytes()) {
            throw new BusinessException(ErrorCode.FILE_SIZE_EXCEEDED);
        }
        if (request.durationSec() > limit.maxDurationSec()) {
            throw new BusinessException(ErrorCode.VIDEO_TOO_LONG);
        }
        long used = generationRequestService.countUsage(userId, GenerationRequestService.todayKst()).get(SourceType.UPLOAD);
        if (used >= limit.dailyCount()) {
            throw new BusinessException(ErrorCode.DAILY_LIMIT_EXCEEDED, "오늘 내 영상 해설 횟수를 다 썼어요.");
        }
        // 올리는 중인 업로드도 완료되면 차감되므로 남은 횟수를 미리 잡아 둔다
        long inProgress = videoUploadRepository.countInProgress(userId, IN_PROGRESS, Instant.now().minus(IN_PROGRESS_WINDOW));
        if (used + inProgress >= limit.dailyCount()) {
            throw new BusinessException(ErrorCode.DAILY_LIMIT_EXCEEDED,
                    "올리는 중인 영상이 있어 오늘 더 올릴 수 없어요. 올리던 영상을 끝내거나 취소해 주세요.");
        }
    }

    private VideoUpload getOwnUpload(Long userId, Long videoId, boolean forUpdate) {
        Optional<VideoUpload> found = forUpdate
                ? videoUploadRepository.findByIdForUpdate(videoId)
                : videoUploadRepository.findById(videoId);
        VideoUpload upload = found.orElseThrow(() -> new BusinessException(ErrorCode.VIDEO_NOT_FOUND));
        if (!upload.getVideo().isUploadedBy(userId)) {
            throw new BusinessException(ErrorCode.FORBIDDEN, "영상을 올린 회원만 할 수 있어요.");
        }
        return upload;
    }

    /** 관리자는 제한이 없어 null */
    private Integer remaining(User user, LocalDate today) {
        return usageLimitProperties.forRole(user.getRole())
                .map(limit -> {
                    long used = generationRequestService.countUsage(user.getId(), today).get(SourceType.UPLOAD);
                    return (int) Math.max(0, limit.upload().dailyCount() - used);
                })
                .orElse(null);
    }

    private long partSize() {
        return s3Properties.uploadPartSize().toBytes();
    }

    private static long partCount(long sizeBytes, long partSize) {
        return Math.ceilDiv(sizeBytes, partSize);
    }

    private static boolean coversAllParts(List<UploadedPart> sortedParts, long partCount) {
        if (sortedParts.size() != partCount) {
            return false;
        }
        for (int i = 0; i < sortedParts.size(); i++) {
            if (sortedParts.get(i).partNumber() != i + 1) {
                return false;
            }
        }
        return true;
    }
}
