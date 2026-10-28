"""RabbitMQ 교환기·큐 이름과 선언 (워커 메시지 명세 1장 큐 목록).

- audisay.job (direct): 작업 큐. 라우팅 키 = 큐 이름
- audisay.retry.10s / audisay.retry.30s (fanout): 대기 큐로 보내는 교환기. 대기 큐는 TTL이 끝나면
  audisay.job으로 되돌리는데, 라우팅 키를 지정하지 않아 처음 보낸 라우팅 키(원래 큐 이름)로 돌아간다
- audisay.dlx (fanout) → job.dlq: 3번 실패한 메시지
"""
import aio_pika
from aio_pika.abc import AbstractChannel, AbstractExchange

JOB_EXCHANGE = "audisay.job"
DLX_EXCHANGE = "audisay.dlx"
RETRY_EXCHANGES = {1: ("audisay.retry.10s", "job.retry.10s", 10_000), 2: ("audisay.retry.30s", "job.retry.30s", 30_000)}

WORK_QUEUES = ["job.prepare", "job.transcribe", "job.scene", "job.describe", "job.merge", "job.tts", "line.tts"]
EVENTS_QUEUE = "job.events"
DLQ = "job.dlq"
DLQ_TTL_MS = 7 * 24 * 3600 * 1000  # DLQ 메시지는 7일 보관


class Exchanges:
    def __init__(self, job: AbstractExchange, dlx: AbstractExchange, retry: dict[int, AbstractExchange]):
        self.job, self.dlx, self.retry = job, dlx, retry


async def declare(ch: AbstractChannel, create: bool) -> Exchanges:
    """create=False면 Spring이 이미 선언한 것을 확인만 한다(passive)."""
    passive = not create
    job = await ch.declare_exchange(JOB_EXCHANGE, aio_pika.ExchangeType.DIRECT, durable=True, passive=passive)
    dlx = await ch.declare_exchange(DLX_EXCHANGE, aio_pika.ExchangeType.FANOUT, durable=True, passive=passive)
    retry = {}
    for n, (ex_name, q_name, ttl) in RETRY_EXCHANGES.items():
        ex = await ch.declare_exchange(ex_name, aio_pika.ExchangeType.FANOUT, durable=True, passive=passive)
        if create:
            q = await ch.declare_queue(q_name, durable=True,
                                       arguments={"x-message-ttl": ttl, "x-dead-letter-exchange": JOB_EXCHANGE})
            await q.bind(ex)
        retry[n] = ex
    if create:
        for name in WORK_QUEUES + [EVENTS_QUEUE]:
            q = await ch.declare_queue(name, durable=True)
            await q.bind(job, routing_key=name)
        dlq = await ch.declare_queue(DLQ, durable=True, arguments={"x-message-ttl": DLQ_TTL_MS})
        await dlq.bind(dlx)
    return Exchanges(job, dlx, retry)
