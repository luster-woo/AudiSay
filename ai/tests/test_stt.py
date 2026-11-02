"""/internal/stt: videoId 받기, 60초 문구, H200 받아쓰기 시간 제한(BE 요청, 2026-11-02). H200·GMS·ffmpeg 없이."""
from fastapi.testclient import TestClient

from app import inference, internal_api
from app.config import Settings


def _client(monkeypatch, inf):
    monkeypatch.setattr(internal_api, "settings", lambda: Settings(_env_file=None, ai_internal_token="secret"))
    monkeypatch.setattr(internal_api.inference, "for_chat", lambda cfg, feature: inf)

    async def to_wav(raw):
        return b"RIFFwav"

    monkeypatch.setattr(internal_api, "_to_wav16k", to_wav)
    from app.main import app

    app.state.db = None
    return TestClient(app)  # with 없이 만들어 lifespan(RabbitMQ 연결)을 돌리지 않는다


def test_stt_takes_video_id(monkeypatch):
    c = _client(monkeypatch, inference.MockInference())
    h = {"X-Internal-Token": "secret"}
    r = c.post("/internal/stt", files={"audio": ("q.webm", b"abc", "audio/webm")}, data={"videoId": "58"}, headers=h)
    assert r.status_code == 200 and r.json()["videoId"] == 58 and r.json()["engine"] == "H200"
    no_id = c.post("/internal/stt", files={"audio": ("q.webm", b"abc", "audio/webm")}, headers=h)  # videoId 없이도 된다
    assert no_id.status_code == 200 and no_id.json()["videoId"] is None


def test_stt_too_big_says_60_seconds(monkeypatch):
    c = _client(monkeypatch, inference.MockInference())
    big = b"0" * (internal_api.STT_MAX_BYTES + 1)
    r = c.post("/internal/stt", files={"audio": ("q.webm", big, "audio/webm")}, headers={"X-Internal-Token": "secret"})
    assert r.status_code == 400 and r.json()["detail"] == {"code": "STT_002", "message": "녹음이 너무 길어요. 60초 안으로 말해 주세요."}


def test_h200_stt_timeout_is_short():
    assert inference.STT_TIMEOUT <= 15 < inference.CHAT_TIMEOUT
