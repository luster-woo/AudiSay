package com.audisay.domain.video.repository;

import com.audisay.domain.video.entity.UploadStatus;
import com.audisay.domain.video.entity.VideoUpload;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.Optional;

public interface VideoUploadRepository extends JpaRepository<VideoUpload, Long> {

    /**
     * 완료·중단처럼 상태를 바꿀 때. 같은 업로드를 동시에 완료하거나 완료와 중단이 겹치지 않게 행을 잠근다.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select u from VideoUpload u join fetch u.video where u.videoId = :videoId")
    Optional<VideoUpload> findByIdForUpdate(@Param("videoId") Long videoId);

    /**
     * 회원이 올리는 중인 업로드 수. 완료 전에는 횟수를 차감하지 않으므로, 시작할 때 이 수만큼 남은 횟수를 미리 잡는다.
     */
    @Query("""
            select count(u) from VideoUpload u
            where u.video.uploader.id = :userId and u.uploadStatus in :statuses and u.createdAt > :since
            """)
    long countInProgress(@Param("userId") Long userId, @Param("statuses") Collection<UploadStatus> statuses,
                         @Param("since") Instant since);
}
