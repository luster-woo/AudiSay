"""SSAFY GMS를 거쳐 Gemini를 부르는 클라이언트.

모든 호출은 레이트 리미터를 거치고, 끝나면(성공·실패 모두) ai_call_logs에 한 행을 남긴다.
일시적 오류(503, 429)는 짧게 몇 번 다시 부르고, 그래도 안 되면 예외를 올려 큐 재시도에 맡긴다.
"""
import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any

from google import genai
from google.genai import types

from app.config import Settings
from app.db import CallLog, Db
from app.errors import WorkerError
from app.gms.rate_limiter import RateLimiter

log = logging.getLogger(__name__)

TRANSIENT = ("503", "429", "UNAVAILABLE", "RESOURCE_EXHAUSTED", "500", "INTERNAL")
# 영상에 접근할 수 없을 때 Gemini가 주는 오류 문구. 다시 해도 같으므로 재시도하지 않는다
UNAVAILABLE_HINTS = ("private video", "video is private", "unavailable video", "video is unavailable",
                     "cannot fetch", "cannot be accessed")
# 이 말들은 GMS 키 만료(403 PERMISSION_DENIED)·'model not available' 같은 서버 쪽 문제에도 나온다.
# 영상('video'·'youtube')과 함께 나올 때만 영상 문제로 본다 (2026-11-10 점검: 키 오류가 '영상이 비공개로 바뀌어…'로 안내됨)
AMBIGUOUS_HINTS = ("permission_denied", "not available", "private")
VIDEO_WORDS = ("video", "youtube", "file_uri", "fileuri")


def video_unavailable(msg: str) -> bool:
    """Gemini 오류 문구가 '영상에 접근할 수 없음'(다시 해도 같음)인지. 키·권한·모델 문제는 False(다시 시도)."""
    low = msg.lower()
    if any(h in low for h in UNAVAILABLE_HINTS):
        return True
    return any(h in low for h in AMBIGUOUS_HINTS) and any(w in low for w in VIDEO_WORDS)


@dataclass
class CallContext:
    purpose: str
    job_id: int | None = None
    chunk_index: int | None = None
    chat_log_id: int | None = None


class GmsClient:
    def __init__(self, cfg: Settings, limiter: RateLimiter, db: Db):
        if not cfg.gms_api_key or not cfg.gms_gemini_base_url:
            log.warning("GMS_API_KEY 또는 GMS_GEMINI_BASE_URL이 비어 있습니다. AI 호출이 실패합니다.")
        self._client = genai.Client(api_key=cfg.gms_api_key or "missing",
                                    http_options=types.HttpOptions(base_url=cfg.gms_gemini_base_url or None))
        self.limiter, self.db = limiter, db

    async def generate(self, model: str, contents: Any, config: types.GenerateContentConfig, ctx: CallContext,
                       retries: int = 3) -> types.GenerateContentResponse:
        for attempt in range(retries + 1):
            await self.limiter.acquire()
            t0 = time.monotonic()
            try:
                r = await self._client.aio.models.generate_content(model=model, contents=contents, config=config)
            except Exception as e:  # noqa: BLE001
                msg = str(e)
                await self._log(model, ctx, t0, None, _error_code(msg))
                if ("thinking" in msg.lower() or "INVALID_ARGUMENT" in msg) and config.thinking_config is not None:
                    config.thinking_config = None  # thinking 끄기를 지원하지 않는 모델
                    continue
                if video_unavailable(msg):
                    raise WorkerError("VIDEO_UNAVAILABLE", msg[:500]) from e
                if any(k in msg for k in TRANSIENT) and attempt < retries:
                    wait = 5 * 2 ** attempt
                    log.info("GMS 일시 오류, %s초 뒤 다시 호출: %s", wait, msg[:80])
                    await asyncio.sleep(wait)
                    continue
                raise
            await self._log(model, ctx, t0, r.usage_metadata, None)
            return r
        raise WorkerError("UNKNOWN", "GMS 재시도 횟수 초과")

    async def _log(self, model: str, ctx: CallContext, t0: float, usage: Any, error_code: str | None) -> None:
        get = (lambda k: getattr(usage, k, None) or 0) if usage else (lambda k: 0)
        await self.db.log_call(CallLog(
            purpose=ctx.purpose, model=model, job_id=ctx.job_id, chunk_index=ctx.chunk_index,
            chat_log_id=ctx.chat_log_id, input_tokens=get("prompt_token_count"),
            output_tokens=get("candidates_token_count") + get("thoughts_token_count"),
            latency_ms=int((time.monotonic() - t0) * 1000), error_code=error_code,
        ))


def _error_code(msg: str) -> str:
    if "429" in msg or "RESOURCE_EXHAUSTED" in msg:
        return "AI_LIMIT"
    if "timeout" in msg.lower() or "DEADLINE" in msg:
        return "AI_TIMEOUT"
    return "UNKNOWN"
