package com.audisay.global.exception;

import lombok.Getter;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;

@Getter
@RequiredArgsConstructor
public enum ErrorCode {
    INVALID_INPUT(HttpStatus.BAD_REQUEST, "COMMON_001", "유효하지 않은 요청입니다."),
    UNAUTHORIZED(HttpStatus.UNAUTHORIZED, "COMMON_002", "로그인이 필요합니다."),
    FORBIDDEN(HttpStatus.FORBIDDEN, "COMMON_003", "권한이 없습니다."),
    INTERNAL_SERVER_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "COMMON_004", "일시적인 오류입니다. 잠시 후 다시 시도해 주세요."),
    API_NOT_FOUND(HttpStatus.NOT_FOUND, "COMMON_005", "존재하지 않는 주소입니다."),
    METHOD_NOT_ALLOWED(HttpStatus.METHOD_NOT_ALLOWED, "COMMON_006", "지원하지 않는 요청 방식입니다."),

    LOGIN_FAILED(HttpStatus.UNAUTHORIZED, "AUTH_001", "이메일 또는 비밀번호가 일치하지 않습니다."),
    REFRESH_TOKEN_INVALID(HttpStatus.UNAUTHORIZED, "AUTH_002", "로그인이 만료되었습니다. 다시 로그인해 주세요."),
    ACCESS_TOKEN_EXPIRED(HttpStatus.UNAUTHORIZED, "AUTH_003", "AccessToken이 만료되었습니다."),
    /** 같은 기기(sid)의 RefreshToken이 다른 탭·창에서 이미 바뀌었다. 동시에 여러 곳에서 쓸 수 없다(의도된 로그아웃) */
    REFRESH_TOKEN_REPLACED(HttpStatus.UNAUTHORIZED, "AUTH_004",
            "다른 탭이나 창에서 로그인 정보가 바뀌어 이 화면은 로그아웃됐어요. AudiSay는 한 번에 한 곳에서만 쓸 수 있어요. 다시 로그인해 주세요."),

    DUPLICATE_EMAIL(HttpStatus.CONFLICT, "USER_001", "이미 사용 중인 이메일입니다."),
    PASSWORD_MISMATCH(HttpStatus.BAD_REQUEST, "USER_002", "비밀번호가 일치하지 않습니다."),
    ALREADY_VERIFIED(HttpStatus.CONFLICT, "USER_003", "이미 인증된 회원입니다."),
    SENSITIVE_INFO_NOT_AGREED(HttpStatus.BAD_REQUEST, "USER_004", "민감정보 처리에 동의해야 인증을 신청할 수 있습니다."),
    USER_NOT_FOUND(HttpStatus.NOT_FOUND, "USER_005", "존재하지 않는 회원입니다."),
    VERIFICATION_DOCUMENT_REJECTED(HttpStatus.valueOf(422), "USER_006", "시각장애를 확인할 수 있는 서류가 아닙니다."),
    VERIFICATION_ATTEMPT_LIMIT(HttpStatus.TOO_MANY_REQUESTS, "USER_007", "오늘은 인증 신청을 더 할 수 없습니다. 내일 다시 시도해 주세요."),
    VERIFICATION_BUSY(HttpStatus.SERVICE_UNAVAILABLE, "USER_008", "지금은 인증 서류 확인이 밀려 있습니다. 잠시 후 다시 시도해 주세요."),

    INVALID_YOUTUBE_URL(HttpStatus.BAD_REQUEST, "VIDEO_001", "유튜브 링크 형식이 아닙니다."),
    YOUTUBE_VIDEO_UNAVAILABLE(HttpStatus.valueOf(422), "VIDEO_002", "비공개이거나 삭제된 영상입니다."),
    YOUTUBE_EMBED_BLOCKED(HttpStatus.valueOf(422), "VIDEO_003", "다른 사이트에서 재생을 막은 영상입니다."),
    VIDEO_TOO_LONG(HttpStatus.valueOf(422), "VIDEO_004", "영상이 길이 제한을 넘습니다."),
    VIDEO_RESTRICTED(HttpStatus.valueOf(422), "VIDEO_005", "연령 제한·실시간 방송 영상은 지원하지 않습니다."),
    VIDEO_NOT_FOUND(HttpStatus.NOT_FOUND, "VIDEO_006", "존재하지 않는 영상입니다."),
    VIDEO_PRIVATE(HttpStatus.FORBIDDEN, "VIDEO_007", "비공개 영상입니다."),
    YOUTUBE_SEARCH_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "VIDEO_008", "지금은 검색을 쓸 수 없습니다."),

    UNSUPPORTED_VIDEO_FORMAT(HttpStatus.BAD_REQUEST, "UPLOAD_001", "MP4, MOV, WebM 파일만 올릴 수 있습니다."),
    FILE_SIZE_EXCEEDED(HttpStatus.BAD_REQUEST, "UPLOAD_002", "파일 용량이 제한을 넘습니다. 해상도를 낮춰 올려 주세요."),
    COPYRIGHT_NOT_AGREED(HttpStatus.BAD_REQUEST, "UPLOAD_003", "저작권 동의가 필요합니다."),
    UPLOAD_ALREADY_CLOSED(HttpStatus.CONFLICT, "UPLOAD_004", "이미 완료되었거나 중단된 업로드입니다."),
    UPLOAD_PART_MISMATCH(HttpStatus.BAD_REQUEST, "UPLOAD_005", "올라간 조각 정보가 맞지 않습니다."),
    PLAYBACK_NOT_READY(HttpStatus.CONFLICT, "UPLOAD_006", "아직 재생용 파일을 만드는 중입니다."),
    PLAYBACK_FAILED(HttpStatus.UNPROCESSABLE_ENTITY, "UPLOAD_007", "영상 파일을 읽을 수 없어 재생할 수 없어요."),

    DAILY_LIMIT_EXCEEDED(HttpStatus.TOO_MANY_REQUESTS, "LIMIT_001", "오늘 이용 횟수를 모두 사용했습니다."),
    RETRY_LIMIT_EXCEEDED(HttpStatus.TOO_MANY_REQUESTS, "LIMIT_002", "이 영상은 오늘 더 다시 요청할 수 없습니다."),

    JOB_NOT_FOUND(HttpStatus.NOT_FOUND, "JOB_001", "존재하지 않는 작업입니다."),
    JOB_ALREADY_RUNNING(HttpStatus.CONFLICT, "JOB_002", "이미 해설을 만드는 중입니다."),
    JOB_NOT_RETRYABLE(HttpStatus.CONFLICT, "JOB_003", "다시 요청할 수 없는 상태입니다."),

    DESCRIPTION_NOT_FOUND(HttpStatus.NOT_FOUND, "DESC_001", "존재하지 않는 해설입니다."),
    DESCRIPTION_NOT_IN_RANGE(HttpStatus.NOT_FOUND, "DESC_002", "이 구간은 해설이 없습니다."),
    DESCRIPTION_LINE_NOT_FOUND(HttpStatus.NOT_FOUND, "DESC_003", "존재하지 않는 해설 문장입니다."),

    SPEECH_NOT_RECOGNIZED(HttpStatus.valueOf(422), "CHAT_001", "말을 알아듣지 못했어요. 다시 말씀해 주세요."),
    INVALID_AUDIO_FILE(HttpStatus.BAD_REQUEST, "CHAT_002", "음성 파일 형식·길이가 맞지 않습니다."),
    NOT_ANSWERABLE_INPUT(HttpStatus.CONFLICT, "CHAT_003", "답변이 필요한 입력이 아닙니다."),
    CHAT_LOG_NOT_FOUND(HttpStatus.NOT_FOUND, "CHAT_004", "존재하지 않는 챗봇 기록입니다."),
    CHAT_AI_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "CHAT_005", "지금은 처리할 수 없어요. 잠시 후 다시 시도해 주세요."),
    CHAT_AI_TIMEOUT(HttpStatus.GATEWAY_TIMEOUT, "CHAT_006", "응답이 늦어지고 있어요. 다시 시도해 주세요."),
    CHAT_AI_LIMIT(HttpStatus.TOO_MANY_REQUESTS, "CHAT_007", "지금은 이용할 수 없어요. 나중에 다시 시도해 주세요."),
    ANSWER_IN_PROGRESS(HttpStatus.CONFLICT, "CHAT_008", "이미 답변을 만드는 중입니다."),
    CHAT_RATE_LIMIT(HttpStatus.TOO_MANY_REQUESTS, "CHAT_009", "너무 자주 말씀하셨어요. 잠시 후에 다시 말씀해 주세요."),
    FUTURE_NOT_AVAILABLE(HttpStatus.CONFLICT, "CHAT_010", "지금 이후 내용을 들을 수 있는 답변이 아닙니다."),

    ALREADY_REPORTED(HttpStatus.CONFLICT, "REPORT_001", "이미 신고한 문장입니다."),
    REPORT_NOT_FOUND(HttpStatus.NOT_FOUND, "REPORT_002", "존재하지 않는 신고입니다."),
    REPORT_ALREADY_HANDLED(HttpStatus.CONFLICT, "REPORT_003", "이미 처리된 신고입니다.");

    private final HttpStatus status;
    private final String code;
    private final String message;
}
