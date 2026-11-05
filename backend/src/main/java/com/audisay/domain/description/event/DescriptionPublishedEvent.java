package com.audisay.domain.description.event;

/** 해설이 공개(PUBLISHED)됐다. 커밋 뒤 장면 검색 색인이 듣는다 */
public record DescriptionPublishedEvent(long descriptionId) {
}
