"""PostgreSQL 연결과 ai_call_logs 기록.

ai_call_logs 기록이 실패해도(테이블이 아직 없음, DB 연결 끊김) 본 작업은 멈추지 않는다. 로그만 남긴다.
"""
import logging
from dataclasses import dataclass

import asyncpg

from app.config import Settings

log = logging.getLogger(__name__)


@dataclass
class CallLog:
    purpose: str  # STT / DESCRIBE / SHORTEN / SUMMARY / CHAPTER / CLASSIFY / QUESTION / INTENT / TTS
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    image_count: int = 0
    estimated_credits: float = 0.0
    latency_ms: int | None = None
    error_code: str | None = None
    job_id: int | None = None
    chunk_index: int | None = None  # job_chunks.id는 (job_id, chunk_index)로 찾는다
    chat_log_id: int | None = None


INSERT = """
INSERT INTO ai_call_logs (job_id, chunk_id, chat_log_id, purpose, model, input_tokens, output_tokens,
                          image_count, estimated_credits, latency_ms, error_code)
VALUES (CASE WHEN $2::int IS NULL THEN $1::bigint END,
        CASE WHEN $2::int IS NULL THEN NULL
             ELSE (SELECT id FROM job_chunks WHERE job_id = $1::bigint AND chunk_index = $2::int) END,
        $3, $4, $5, $6, $7, $8, $9, $10, $11)
"""
# 작업·조각·챗봇 중 한 곳에만 연결한다(ck_ai_call_logs_target). 조각 호출이면 job_id는 비우고 chunk_id만 넣는다


class Db:
    def __init__(self, cfg: Settings):
        self.cfg = cfg
        self.pool: asyncpg.Pool | None = None

    async def start(self) -> None:
        c = self.cfg
        try:
            self.pool = await asyncpg.create_pool(host=c.postgres_host, port=c.postgres_port, database=c.postgres_db,
                                                  user=c.postgres_user, password=c.postgres_password,
                                                  min_size=1, max_size=5, timeout=5)
        except Exception as e:  # noqa: BLE001
            log.warning("DB에 연결하지 못해 ai_call_logs를 남기지 않습니다: %s", e)

    async def stop(self) -> None:
        if self.pool:
            await self.pool.close()

    async def log_call(self, c: CallLog) -> None:
        if not self.pool:
            return
        chunk = c.chunk_index if c.job_id is not None else None
        try:
            await self.pool.execute(INSERT, c.job_id, chunk, c.chat_log_id, c.purpose, c.model, c.input_tokens,
                                    c.output_tokens, c.image_count, c.estimated_credits, c.latency_ms, c.error_code)
        except Exception as e:  # noqa: BLE001
            log.warning("ai_call_logs 기록 실패(%s %s): %s", c.purpose, c.model, e)
