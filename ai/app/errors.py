"""작업 실패 원인 코드 (API 명세서 > 작업 실패 원인 코드).

다시 해도 안 되는 오류는 재시도하지 않고 바로 FAILED 이벤트를 보낸다.
나머지는 대기 큐(10초 → 30초)로 다시 시도하고, 3번째 실패하면 job.dlq로 보낸다.
"""

NON_RETRYABLE = {"VIDEO_UNAVAILABLE", "DURATION_MISMATCH", "TRANSCODE_FAILED"}


class WorkerError(Exception):
    def __init__(self, code: str, detail: str = "", retryable: bool | None = None):
        super().__init__(f"{code}: {detail}")
        self.code = code
        self.detail = detail
        self._retryable = retryable

    @property
    def retryable(self) -> bool:
        if self._retryable is not None:
            return self._retryable
        return self.code not in NON_RETRYABLE


def classify(e: BaseException) -> WorkerError:
    """임의의 예외를 실패 원인 코드로 바꾼다."""
    if isinstance(e, WorkerError):
        return e
    if isinstance(e, TimeoutError):
        return WorkerError("AI_TIMEOUT", str(e) or "timeout")
    msg = str(e)
    if any(k in msg for k in ("429", "RESOURCE_EXHAUSTED", "rate limit")):
        return WorkerError("AI_LIMIT", msg[:500])
    return WorkerError("UNKNOWN", f"{type(e).__name__}: {msg}"[:500])
