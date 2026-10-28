"""메시지 봉투와 작업 이벤트 (워커 메시지 명세 1장, 9장)."""
import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field

MessageType = Literal[
    "JOB_PREPARE", "JOB_TRANSCRIBE", "JOB_SCENE", "JOB_DESCRIBE", "JOB_MERGE", "JOB_TTS", "LINE_TTS", "JOB_EVENT",
]
Stage = Literal["PREPARE", "DESCRIBE", "MERGE", "TTS"]
EventName = Literal["STAGE_STARTED", "PROGRESS", "CHUNK_SUCCEEDED", "STAGE_COMPLETED", "FAILED"]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class Envelope(BaseModel):
    messageId: str
    type: MessageType
    jobId: int | None = None
    attempt: int = 1
    createdAt: str = Field(default_factory=now_iso)
    payload: dict[str, Any] = Field(default_factory=dict)
    lastError: dict[str, Any] | None = None


class JobEvent(BaseModel):
    event: EventName
    stage: Stage
    chunkIndex: int | None = None
    progress: int | None = None
    result: dict[str, Any] | None = None
    errorCode: str | None = None
    errorDetail: str | None = None
    workerId: str


def event_envelope(job_id: int | None, attempt: int, ev: JobEvent) -> Envelope:
    return Envelope(messageId=str(uuid.uuid4()), type="JOB_EVENT", jobId=job_id, attempt=attempt,
                    payload=ev.model_dump())
