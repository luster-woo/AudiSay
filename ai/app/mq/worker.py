"""큐 메시지를 받아 처리하고, 결과를 job.events로 알린다 (워커 메시지 명세 1장 처리 규칙, 10장 재시도).

- 일을 끝낸 뒤 ack한다. 같은 messageId는 한 번만 처리한다(Redis에 처리 완료 표시)
- 실패하면 attempt를 1 올려 대기 큐(10초 → 30초)로, 3번째 실패하면 job.dlq로 보낸다
- 다시 해도 안 되는 오류는 재시도하지 않고 바로 FAILED 이벤트를 보낸다
- 한 메시지 처리 제한 시간은 10분, 넘으면 AI_TIMEOUT
"""
import asyncio
import json
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any

import aio_pika
from aio_pika.abc import AbstractIncomingMessage
from prometheus_client import Counter, Histogram
from redis.asyncio import Redis

from app.config import Settings
from app.errors import WorkerError, classify
from app.mq import topology
from app.mq.envelope import Envelope, JobEvent, Stage, event_envelope

log = logging.getLogger(__name__)

MESSAGES = Counter("ai_messages_total", "처리한 큐 메시지 수", ["queue", "result"])
DURATION = Histogram("ai_message_seconds", "메시지 하나 처리 시간(초)", ["queue"],
                     buckets=(1, 5, 15, 30, 60, 120, 300, 600))

DONE_TTL_SEC = 24 * 3600
STAGE_OF = {"job.prepare": "PREPARE", "job.describe": "DESCRIBE", "job.merge": "MERGE", "job.tts": "TTS"}


class Events:
    """한 메시지를 처리하는 동안 job.events로 보내는 이벤트 도우미."""

    def __init__(self, worker: "Worker", env: Envelope, stage: Stage):
        self.worker, self.env, self.stage = worker, env, stage

    async def send(self, event: str, **kw: Any) -> None:
        ev = JobEvent(event=event, stage=self.stage, workerId=self.worker.cfg.worker_id, **kw)
        await self.worker.publish_event(event_envelope(self.env.jobId, self.env.attempt, ev))

    async def started(self) -> None:
        await self.send("STAGE_STARTED")

    async def progress(self, progress: int) -> None:
        await self.send("PROGRESS", progress=progress)

    async def completed(self, result: dict, progress: int | None = None) -> None:
        await self.send("STAGE_COMPLETED", result=result, progress=progress)

    async def chunk_succeeded(self, chunk_index: int, result: dict) -> None:
        await self.send("CHUNK_SUCCEEDED", chunkIndex=chunk_index, result=result)


Handler = Callable[[Envelope, Events], Awaitable[None]]


class Worker:
    def __init__(self, cfg: Settings, redis: Redis, handlers: dict[str, Handler]):
        self.cfg, self.redis, self.handlers = cfg, redis, handlers
        self.conn: aio_pika.abc.AbstractRobustConnection | None = None
        self.ex: topology.Exchanges | None = None
        self.connected = False

    async def start(self) -> None:
        c = self.cfg
        self.conn = await aio_pika.connect_robust(host=c.rabbitmq_host, port=c.rabbitmq_port,
                                                  login=c.rabbitmq_default_user, password=c.rabbitmq_default_pass)
        ch = await self.conn.channel()
        self.ex = await topology.declare(ch, create=c.mq_declare)
        for name in [q.strip() for q in c.worker_queues.split(",") if q.strip()]:
            if name not in self.handlers:
                raise RuntimeError(f"{name} 처리기가 없습니다")
            qch = await self.conn.channel()
            await qch.set_qos(prefetch_count=c.worker_prefetch)
            q = await qch.declare_queue(name, durable=True, passive=True)
            await q.consume(lambda m, n=name: self.on_message(n, m))
            log.info("큐 구독 시작: %s", name)
        self.connected = True

    async def stop(self) -> None:
        self.connected = False
        if self.conn:
            await self.conn.close()

    async def publish(self, exchange: aio_pika.abc.AbstractExchange, env: Envelope, routing_key: str) -> None:
        body = env.model_dump_json().encode()
        await exchange.publish(aio_pika.Message(body, content_type="application/json",
                                                delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
                                                message_id=env.messageId), routing_key=routing_key)

    async def publish_event(self, env: Envelope) -> None:
        await self.publish(self.ex.job, env, topology.EVENTS_QUEUE)

    async def on_message(self, queue: str, msg: AbstractIncomingMessage) -> None:
        t0 = time.monotonic()
        result = await self.process(queue, msg.body)
        MESSAGES.labels(queue, result).inc()
        DURATION.labels(queue).observe(time.monotonic() - t0)
        await msg.ack()

    async def process(self, queue: str, body: bytes) -> str:
        """메시지 하나를 처리하고 결과 이름(ok / skipped / failed / retry / dlq / invalid)을 돌려준다. 항상 ack한다."""
        try:
            env = Envelope.model_validate(json.loads(body))
        except Exception as e:  # noqa: BLE001 - 형식이 틀린 메시지는 다시 해도 같으므로 DLQ로
            log.error("봉투 형식 오류 (%s): %s", queue, e)
            await self.dlx_raw(body, f"invalid envelope: {e}")
            return "invalid"

        done_key = f"ai:done:{env.messageId}"
        if await self.redis.exists(done_key):
            log.info("이미 처리한 메시지 %s (%s)", env.messageId, queue)
            return "skipped"

        events = Events(self, env, STAGE_OF.get(queue, "TTS"))
        try:
            await asyncio.wait_for(self.handlers[queue](env, events), timeout=self.cfg.message_timeout_sec)
        except Exception as e:  # noqa: BLE001
            err = classify(e) if not isinstance(e, asyncio.TimeoutError) else WorkerError(
                "AI_TIMEOUT", f"처리 시간 {self.cfg.message_timeout_sec}초 초과")
            log.warning("처리 실패 %s job=%s attempt=%s: %s", queue, env.jobId, env.attempt, err)
            return await self.on_failure(queue, env, events, err)

        await self.redis.set(done_key, "1", ex=DONE_TTL_SEC)
        return "ok"

    async def on_failure(self, queue: str, env: Envelope, events: Events, err: WorkerError) -> str:
        if not err.retryable:
            if env.jobId is not None:
                await events.send("FAILED", chunkIndex=env.payload.get("chunkIndex"),
                                  errorCode=err.code, errorDetail=err.detail[:1000])
            return "failed"
        if env.attempt >= self.cfg.max_attempts:
            dead = env.model_copy(update={"lastError": {"errorCode": err.code, "errorDetail": err.detail[:1000]}})
            await self.publish(self.ex.dlx, dead, queue)
            return "dlq"
        nxt = env.model_copy(update={"attempt": env.attempt + 1})
        await self.publish(self.ex.retry[env.attempt], nxt, queue)
        return "retry"

    async def dlx_raw(self, body: bytes, reason: str) -> None:
        await self.ex.dlx.publish(aio_pika.Message(body, headers={"x-error": reason[:500]},
                                                   delivery_mode=aio_pika.DeliveryMode.PERSISTENT), routing_key="")
