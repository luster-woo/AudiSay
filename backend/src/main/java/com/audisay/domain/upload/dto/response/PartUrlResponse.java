package com.audisay.domain.upload.dto.response;

import java.time.Instant;
import java.util.List;

public record PartUrlResponse(List<PartUrl> parts, Instant expiresAt) {

    public record PartUrl(int partNumber, String url) {
    }
}
