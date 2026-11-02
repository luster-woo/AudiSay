"""/internal/stt(명세 1번): videoId 힌트, 오류 코드, Spring 제한 10초 안의 시간 나누기. H200·GMS·ffmpeg 없이."""
from fastapi.testclient import TestClient

from app import inference, internal_api
from app.config import Settings


class HintSpy(inference.MockInference):
    def __init__(self, text="3분 20초로 가 줘"):
        self.text, self.hints = text, []

    async def transcribe_bytes(self, wav, hint=""):
        self.hints.append(hint)
        return {"segments": [{"startMs": 0, "endMs": 1000, "text": self.text}], "model": "spy"}


def _client(monkeypatch, inf, hint="먼작귀 113화. 치이카와, 하치와레"):
    monkeypatch.setattr(internal_api, "settings", lambda: Settings(_env_file=None, ai_internal_token="secret"))
    monkeypatch.setattr(internal_api.inference, "for_chat", lambda cfg, feature: inf)

    async def to_wav(raw):
        return b"RIFFwav"

    async def stt_hint(request, video_id):
        return hint if video_id else ""

    monkeypatch.setattr(internal_api, "_to_wav16k", to_wav)
    monkeypatch.setattr(internal_api, "_stt_hint", stt_hint)
    from app.main import app

    app.state.db = None
    return TestClient(app)  # with 없이 만들어 lifespan(RabbitMQ 연결)을 돌리지 않는다


H = {"X-Internal-Token": "secret"}
AUDIO = {"audio": ("q.webm", b"abc", "audio/webm")}


def test_stt_uses_video_hint(monkeypatch):
    spy = HintSpy()
    c = _client(monkeypatch, spy)
    r = c.post("/internal/stt", files=AUDIO, data={"videoId": "58"}, headers=H)
    assert r.status_code == 200 and r.json()["text"] == "3분 20초로 가 줘" and "latencyMs" in r.json()
    assert c.post("/internal/stt", files=AUDIO, headers=H).status_code == 200  # videoId 없이도 된다
    assert spy.hints == ["먼작귀 113화. 치이카와, 하치와레", ""]


def test_stt_error_codes_per_spec(monkeypatch):
    c = _client(monkeypatch, HintSpy(text=""))
    assert c.post("/internal/stt", files=AUDIO, headers=H).json()["code"] == "STT_EMPTY"  # 422
    big = {"audio": ("q.webm", b"0" * (internal_api.STT_MAX_BYTES + 1), "audio/webm")}
    r = c.post("/internal/stt", files=big, headers=H)
    assert r.status_code == 400 and r.json() == {"code": "STT_FORMAT", "message": "녹음이 너무 길어요. 60초 안으로 말해 주세요."}
    off = _client(monkeypatch, None).post("/internal/stt", files=AUDIO, headers=H)  # H200·GMS 둘 다 없음
    assert off.status_code == 502 and off.json()["code"] == "GMS_ERROR"


def test_timeouts_fit_spring_limits():
    """명세의 Spring 제한: stt 10초, intent 5초, answer 첫 이벤트 10초."""
    assert inference.STT_TIMEOUT + internal_api.WHISPER_TIMEOUT < 10
    assert inference.INTENT_TIMEOUT < 5
    assert inference.CHAT_TIMEOUT * 2 < 10  # 스트리밍 실패 → 한 번에 받기까지 해도 GMS로 넘어갈 시간이 남는다
