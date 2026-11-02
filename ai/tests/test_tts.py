"""안내 목소리(3차 이식): /internal/tts 저장·재사용·실패, 기호 지우기. H200·S3 없이(가짜 추론, 로컬 저장소)."""
from fastapi.testclient import TestClient

from app import inference, internal_api
from app.config import Settings
from app.storage import LocalStorage
from app.tts_text import normalize_ko


def _client(monkeypatch, tmp_path, inf):
    monkeypatch.setattr(internal_api, "settings", lambda: Settings(_env_file=None, ai_internal_token="secret"))
    monkeypatch.setattr(internal_api.inference, "for_chat", lambda cfg, feature: inf)
    from app.main import app

    app.state.storage = LocalStorage(str(tmp_path))
    app.state.db = None
    return TestClient(app)  # with 없이 만들어 lifespan(RabbitMQ 연결)을 돌리지 않는다


def test_tts_saves_once_and_reuses(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path, inference.MockInference())
    h = {"X-Internal-Token": "secret"}
    r = c.post("/internal/tts", json={"text": "▶ 🅰🅲 30초 뒤로 갔어요", "voice": "F1"}, headers=h)
    assert r.status_code == 200 and r.json()["cached"] is False and r.json()["durationMs"] == 1000
    key = r.json()["audioKey"]
    assert key.startswith("audio/guide/F1/") and (tmp_path / key).read_bytes() == b"ID3mock"
    again = c.post("/internal/tts", json={"text": "30초 뒤로 갔어요"}, headers=h).json()  # 기호를 지우면 같은 문장
    assert (again["audioKey"], again["cached"], again["durationMs"]) == (key, True, 1000)
    assert c.post("/internal/tts", json={"text": "🅰🅲"}, headers=h).status_code == 400  # 지우고 나면 빈 문장


def test_tts_off_or_failed_gives_empty_audio_url(monkeypatch, tmp_path):
    h = {"X-Internal-Token": "secret"}
    off = _client(monkeypatch, tmp_path, None).post("/internal/tts", json={"text": "안녕하세요"}, headers=h)
    assert off.status_code == 200 and off.json()["audioUrl"] is None and off.json()["reason"] == "TTS_002"  # FE는 브라우저 음성으로

    class Broken(inference.MockInference):
        async def tts(self, text, voice):
            raise inference.InferenceError("INFER_FAILED", "x")

    bad = _client(monkeypatch, tmp_path, Broken()).post("/internal/tts", json={"text": "안녕하세요"}, headers=h)
    assert bad.status_code == 200 and bad.json()["audioUrl"] is None and bad.json()["reason"] == "TTS_003"


def test_normalize_reads_numbers_and_drops_symbols():
    assert normalize_ko("▶ 🅰🅲🅴 라바 시즌3 😂👍🏻") == "라바 시즌삼"
    assert normalize_ko("1½컵, 58% ❤️") == "한 컵 반, 오십팔퍼센트"
