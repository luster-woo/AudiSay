package com.audisay.domain.admin.dto.response;

import com.audisay.domain.job.entity.JobType;

/**
 * @param currentDescriptionId 새 해설이 완성될 때까지 계속 재생되는 지금 공개 해설. 없으면 null
 */
public record RegenerateResponse(Long videoId, Long jobId, JobType jobType, Long currentDescriptionId) {
}
