import json

import pytest

from app.config import Settings
from app.errors import WorkerError
from app.mq.worker import Worker


class FakeRedis:
    def __init__(self):
        self.d = {}

    async def exists(self, k):
        return k in self.d

    async def set(self, k, v, ex=None):
        self.d[k] = v


class FakeExchange:
    def __init__(self, name, sent):
        self.name, self.sent = name, sent

    async def publish(self, msg, routing_key):
        self.sent.append((self.name, routing_key, json.loads(msg.body) if msg.body.startswith(b"{") else msg.body))


class FakeExchanges:
    def __init__(self, sent):
        self.job = FakeExchange("audisay.job", sent)
        self.dlx = FakeExchange("audisay.dlx", sent)
        self.retry = {1: FakeExchange("audisay.retry.10s", sent), 2: FakeExchange("audisay.retry.30s", sent)}


def make_worker(handler):
    sent = []
    w = Worker(Settings(_env_file=None, message_timeout_sec=1), FakeRedis(), {"job.prepare": handler})
    w.ex = FakeExchanges(sent)
    return w, sent


def body(attempt=1, mid="m-1"):
    return json.dumps({"messageId": mid, "type": "JOB_PREPARE", "jobId": 31, "attempt": attempt,
                       "payload": {"videoId": 15}}).encode()


async def test_success_marks_done_and_skips_duplicate():
    calls = []

    async def ok(env, events):
        calls.append(env.messageId)
        await events.completed({"resultKey": "jobs/31/prepare.json"})

    w, sent = make_worker(ok)
    assert await w.process("job.prepare", body()) == "ok"
    assert await w.process("job.prepare", body()) == "skipped"
    assert calls == ["m-1"]
    ex, key, ev = sent[0]
    assert (ex, key) == ("audisay.job", "job.events")
    assert ev["type"] == "JOB_EVENT" and ev["payload"]["event"] == "STAGE_COMPLETED" and ev["payload"]["stage"] == "PREPARE"


@pytest.mark.parametrize("attempt,exchange", [(1, "audisay.retry.10s"), (2, "audisay.retry.30s")])
async def test_retryable_error_goes_to_wait_queue(attempt, exchange):
    async def boom(env, events):
        raise RuntimeError("503 UNAVAILABLE")

    w, sent = make_worker(boom)
    assert await w.process("job.prepare", body(attempt)) == "retry"
    ex, key, msg = sent[0]
    assert (ex, key) == (exchange, "job.prepare")  # 라우팅 키가 원래 큐라 TTL 뒤 원래 큐로 돌아간다
    assert msg["attempt"] == attempt + 1


async def test_third_failure_goes_to_dlq_with_last_error():
    async def boom(env, events):
        raise RuntimeError("429 RESOURCE_EXHAUSTED")

    w, sent = make_worker(boom)
    assert await w.process("job.prepare", body(3)) == "dlq"
    ex, _, msg = sent[0]
    assert ex == "audisay.dlx" and msg["lastError"]["errorCode"] == "AI_LIMIT"


async def test_non_retryable_sends_failed_event():
    async def private(env, events):
        raise WorkerError("VIDEO_UNAVAILABLE", "video is private")

    w, sent = make_worker(private)
    assert await w.process("job.prepare", body()) == "failed"
    ev = sent[0][2]["payload"]
    assert ev["event"] == "FAILED" and ev["errorCode"] == "VIDEO_UNAVAILABLE"


async def test_timeout_is_ai_timeout():
    import asyncio

    async def slow(env, events):
        await asyncio.sleep(5)

    w, sent = make_worker(slow)
    assert await w.process("job.prepare", body()) == "retry"


async def test_invalid_envelope_goes_to_dlq():
    async def never(env, events):
        raise AssertionError

    w, sent = make_worker(never)
    assert await w.process("job.prepare", b"not json") == "invalid"
    assert sent[0][0] == "audisay.dlx"


def test_timeout_follows_video_length_for_upload_analysis():
    """업로드 영상 분석은 영상 길이의 약 1.4배가 걸려 10분 고정이면 7분 넘는 영상이 매번 끊겼다 (2026-11-10 점검)."""
    from app.mq.envelope import Envelope

    w = Worker(Settings(_env_file=None), FakeRedis(), {})
    local = Envelope(messageId="a", type="JOB_PREPARE", jobId=1, payload={"pipeline": "LOCAL", "durationSec": 3600})
    yt = Envelope(messageId="b", type="JOB_PREPARE", jobId=1, payload={"pipeline": "GEMINI_URL", "durationSec": 3600})
    tts = Envelope(messageId="c", type="JOB_TTS", jobId=1, payload={})
    describe = Envelope(messageId="d", type="JOB_DESCRIBE", jobId=1, payload={})
    assert w.timeout_for("job.prepare", local) == 600 + 7200
    assert w.timeout_for("job.prepare", yt) == 600 + 1080
    assert w.timeout_for("job.tts", tts) == 1800
    assert w.timeout_for("job.describe", describe) == 600


async def test_unexpected_error_still_answers_the_message():
    """process 밖으로 예외가 새도(Redis 끊김) 메시지를 돌려줘 큐가 멈추지 않는다 (2026-11-10 점검)."""

    class BrokenRedis(FakeRedis):
        async def exists(self, k):
            raise ConnectionError("redis down")

    class Msg:
        body = body()

        def __init__(self):
            self.acked = self.nacked = False

        async def ack(self):
            self.acked = True

        async def nack(self, requeue=True):
            self.nacked = requeue

    async def ok(env, events):
        pass

    w = Worker(Settings(_env_file=None), BrokenRedis(), {"job.prepare": ok})
    w.ex = FakeExchanges([])
    m = Msg()
    await w.on_message("job.prepare", m)
    assert m.nacked and not m.acked
