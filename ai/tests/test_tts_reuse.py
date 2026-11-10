"""해설 음성 재사용(2026-11-02): 레포의 데모 음성·S3 캐시에 같은 문장이 있으면 Gemini TTS를 부르지 않는다 (크레딧 0)."""
import json

from app import inference
from app.gms.client import CallContext
from app.pipeline import tts
from app.storage import LocalStorage
from app.tts_text import normalize_ko


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


async def test_upload_video_uses_supertonic_not_gemini(monkeypatch, tmp_path):
    """직접 올린 영상(inf 있음): Supertonic F1로 만들고 Gemini TTS·Gemini 음성 캐시는 쓰지 않는다(2026-11-06)."""
    gemini, voices = [], []

    async def synth(gms, text, ctx):
        gemini.append(text)
        return b"ID3gemini", 100

    class Inf(inference.MockInference):
        async def tts(self, text, voice):
            voices.append((text, voice))
            return b"ID3super", 700

    monkeypatch.setattr(tts, "synthesize", synth)
    storage, text = LocalStorage(str(tmp_path)), _seeded_line()  # Gemini 캐시(레포 음성)에 있는 문장이어도
    out = await tts.synthesize_many(None, storage, [("tts/1/2-abc.mp3", text)], CallContext("TTS", job_id=1), inf=Inf())
    assert gemini == [] and out["tts/1/2-abc.mp3"] == 700
    assert voices == [(normalize_ko(text), "F1")]
    assert (tmp_path / "tts/1/2-abc.mp3").read_bytes() == b"ID3super"
    assert not (tmp_path / tts.tts_cache_key(tts.text_hash(text))).exists()  # Gemini 캐시에 섞지 않는다


async def test_supertonic_failure_leaves_line_empty(tmp_path):
    class Broken(inference.MockInference):
        async def tts(self, text, voice):
            raise inference.InferenceError("INFER_FAILED", "x")

    out = await tts.synthesize_many(None, LocalStorage(str(tmp_path)), [("tts/1/3-a.mp3", "문장입니다.")],
                                    CallContext("TTS", job_id=1), inf=Broken())
    assert out == {"tts/1/3-a.mp3": None}  # FE가 안내 목소리로 읽는다


async def test_only_upload_videos_pick_supertonic():
    class Pool:
        def __init__(self, source):
            self.source = source

        async def fetchval(self, sql, desc_id):
            return self.source

    inf = inference.MockInference()
    assert await tts._upload_inf(Pool("UPLOAD"), 1, inf) is inf
    assert await tts._upload_inf(Pool("YOUTUBE"), 1, inf) is None
    assert await tts._upload_inf(Pool("UPLOAD"), 1, None) is None


async def test_upload_video_falls_back_to_gemini_when_h200_down():
    """GPU 서버가 끊겼으면 업로드 영상도 Gemini TTS로(음성이 비지 않게)."""
    class Pool:
        async def fetchval(self, sql, desc_id):
            return "UPLOAD"

    class Down(inference.MockInference):
        async def healthy(self):
            return False

    assert await tts._upload_inf(Pool(), 1, Down()) is None


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


async def test_youtube_pre_makes_all_levels_upload_only_two():
    """유튜브는 상세도 3까지 job.tts에서 Gemini TTS로 미리 만든다(2026-11-10). 직접 올린 영상은 1·2만."""
    class Pool:
        def __init__(self, source):
            self.source = source

        async def fetchval(self, sql, desc_id):
            return self.source

    assert await tts._pre_tts_level(Pool("YOUTUBE"), 1) == 3
    assert await tts._pre_tts_level(Pool("UPLOAD"), 1) == 2
