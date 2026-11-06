"""해설 음성 재사용(2026-11-02): 레포의 데모 음성·S3 캐시에 같은 문장이 있으면 Gemini TTS를 부르지 않는다 (크레딧 0)."""
import json

from app.gms.client import CallContext
from app.pipeline import tts
from app.storage import LocalStorage


def _seeded_line() -> str:
    """레포에 음성이 있는 데모 문장 하나(노래 영상 유리의 숲)."""
    raw = json.loads((tts.TTS_SEED_DIR.parent / "gemini" / "to3sjq-CAvA.json").read_text(encoding="utf-8"))["result"]
    index = json.loads((tts.TTS_SEED_DIR / "index.json").read_text(encoding="utf-8"))
    return next(x["text"].strip() for x in raw["lines"] if tts.text_hash(x["text"]) in index)


async def test_demo_audio_is_reused_without_gemini(monkeypatch, tmp_path):
    calls = []

    async def synth(gms, text, ctx):
        calls.append(text)
        return b"new", 100

    monkeypatch.setattr(tts, "synthesize", synth)
    storage, text = LocalStorage(str(tmp_path)), _seeded_line()
    out = await tts.synthesize_many(None, storage, [("tts/1/2-abc.mp3", text)], CallContext("TTS", job_id=1))
    assert calls == [] and out["tts/1/2-abc.mp3"] > 0
    assert (tmp_path / "tts/1/2-abc.mp3").read_bytes() == (tts.TTS_SEED_DIR / f"{tts.text_hash(text)}.mp3").read_bytes()


async def test_new_sentence_is_cached_for_next_time(monkeypatch, tmp_path):
    calls = []

    async def synth(gms, text, ctx):
        calls.append(text)
        return b"ID3new", 1200

    monkeypatch.setattr(tts, "synthesize", synth)
    storage, ctx = LocalStorage(str(tmp_path)), CallContext("TTS", job_id=1)
    await tts.synthesize_many(None, storage, [("tts/1/5-a.mp3", "처음 보는 문장입니다.")], ctx)
    out = await tts.synthesize_many(None, storage, [("tts/2/9-b.mp3", "처음 보는 문장입니다.")], ctx)  # 다른 해설, 같은 문장
    assert calls == ["처음 보는 문장입니다."] and out["tts/2/9-b.mp3"] == 1200
    assert (tmp_path / "tts/2/9-b.mp3").read_bytes() == b"ID3new"


async def test_old_cache_audio_is_fixed_once(monkeypatch, tmp_path):
    """헤더 잡음을 고치기 전에 캐시에 들어간 음성(headClean 없음)은 한 번 고쳐 다시 넣고, 다음부터는 그대로 쓴다."""
    fixes = []

    async def fix(mp3):
        fixes.append(mp3)
        return b"ID3fixed"

    monkeypatch.setattr(tts, "remove_head_click", fix)
    storage, text = LocalStorage(str(tmp_path)), "예전에 만든 문장입니다."
    key = tts.tts_cache_key(tts.text_hash(text))
    await storage.put_bytes(key, b"ID3old", "audio/mpeg")
    await storage.put_json(key.removesuffix(".mp3") + ".json", {"durationMs": 900})
    assert await tts.reuse(storage, text) == (b"ID3fixed", 900)
    assert await tts.reuse(storage, text) == (b"ID3fixed", 900)
    assert fixes == [b"ID3old"]
