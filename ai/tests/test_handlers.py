"""prepare·describe 처리기를 가짜 GMS와 로컬 저장소로 끝까지 돌려 본다 (크레딧 0)."""
import json

from fastapi.testclient import TestClient

from app.mq.envelope import Envelope
from app.pipeline.describe import Describe
from app.pipeline.prepare import Prepare
from app.storage import LocalStorage
from tests.fixtures import RAW


class FakeEvents:
    def __init__(self):
        self.sent = []

    async def started(self):
        self.sent.append(("STAGE_STARTED", None))

    async def progress(self, p):
        self.sent.append(("PROGRESS", p))

    async def completed(self, result, progress=None):
        self.sent.append(("STAGE_COMPLETED", result))

    async def chunk_succeeded(self, idx, result):
        self.sent.append(("CHUNK_SUCCEEDED", (idx, result)))


class FakeResponse:
    text = json.dumps(RAW, ensure_ascii=False)


class FakeGms:
    def __init__(self):
        self.calls = 0

    async def generate(self, model, contents, config, ctx):
        self.calls += 1
        assert ctx.purpose == "DESCRIBE" and ctx.job_id == 31
        return FakeResponse()


def prepare_env():
    return Envelope(messageId="p", type="JOB_PREPARE", jobId=31, payload={
        "videoId": 15, "pipeline": "GEMINI_URL", "youtubeUrl": "https://www.youtube.com/watch?v=x",
        "originalKey": None, "durationSec": 190, "title": "라면", "chunkSec": 60})


async def test_prepare_then_describe(tmp_path):
    storage, gms = LocalStorage(str(tmp_path)), FakeGms()
    ev = FakeEvents()
    await Prepare(storage, gms)(prepare_env(), ev)
    name, result = ev.sent[-1]
    assert name == "STAGE_COMPLETED" and result["resultKey"] == "jobs/31/prepare.json"
    assert result["category"] == "ENTERTAINMENT" and len(result["chunks"]) == 3
    assert (tmp_path / "jobs/31/full.json").exists()

    # 같은 메시지가 다시 와도 Gemini를 다시 부르지 않는다
    ev2 = FakeEvents()
    await Prepare(storage, gms)(prepare_env(), ev2)
    assert gms.calls == 1 and ev2.sent[-1][0] == "STAGE_COMPLETED"

    for c in result["chunks"]:
        ev3 = FakeEvents()
        env = Envelope(messageId=f"d{c['chunkIndex']}", type="JOB_DESCRIBE", jobId=31, payload={
            **c, "pipeline": "GEMINI_URL", "youtubeUrl": "https://www.youtube.com/watch?v=x",
            "transcriptKey": None, "scenesKey": None, "category": "ENTERTAINMENT"})
        await Describe(storage)(env, ev3)
        assert ev3.sent[-1] == ("CHUNK_SUCCEEDED", (c["chunkIndex"], {"resultKey": f"jobs/31/chunks/{c['chunkIndex']}.json"}))
    total = sum(len(json.loads((tmp_path / f"jobs/31/chunks/{i}.json").read_text(encoding="utf-8"))["lines"])
                for i in range(3))
    assert total == len(RAW["lines"])


def test_internal_api_requires_token(monkeypatch):
    from app import internal_api
    from app.config import Settings

    monkeypatch.setattr(internal_api, "settings", lambda: Settings(_env_file=None, ai_internal_token="secret"))
    from app.main import app

    c = TestClient(app)  # with 없이 만들어 lifespan(RabbitMQ 연결)을 돌리지 않는다
    assert c.post("/internal/chat/intent", json={"utterance": "안녕"}).status_code == 401
    r = c.post("/internal/chat/intent", json={"utterance": "안녕"}, headers={"X-Internal-Token": "secret"})
    assert r.status_code == 501
