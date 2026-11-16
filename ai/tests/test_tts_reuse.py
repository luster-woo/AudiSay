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

    async def synth(gms, text, ctx, voice=tts.VOICE_NAME):
        calls.append(text)
        return b"new", 100

    monkeypatch.setattr(tts, "synthesize", synth)
    storage, text = LocalStorage(str(tmp_path)), _seeded_line()
    out = await tts.synthesize_many(None, storage, [("tts/1/2-abc.mp3", text)], CallContext("TTS", job_id=1))
    assert calls == [] and out["tts/1/2-abc.mp3"] > 0
    assert (tmp_path / "tts/1/2-abc.mp3").read_bytes() == (tts.TTS_SEED_DIR / f"{tts.text_hash(text)}.mp3").read_bytes()


async def test_new_sentence_is_cached_for_next_time(monkeypatch, tmp_path):
    calls = []

    async def synth(gms, text, ctx, voice=tts.VOICE_NAME):
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

    async def synth(gms, text, ctx, voice=tts.VOICE_NAME):
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
    """유튜브·직접 올린 영상 모두 상세도 3까지 job.tts에서 미리 만든다(2026-11-10).
    BE는 상세도 3용 line.tts를 보내지 않아, 업로드 영상을 1·2만 만들면 3단계 문장은 음성이 영영 생기지 않았다."""
    class Pool:
        def __init__(self, source):
            self.source = source

        async def fetchval(self, sql, desc_id):
            return self.source

    assert await tts._pre_tts_level(Pool("YOUTUBE"), 1) == 3
    assert await tts._pre_tts_level(Pool("UPLOAD"), 1) == 3


async def test_job_tts_saves_in_batches_so_a_timeout_keeps_earlier_audio(monkeypatch, tmp_path):
    """job.tts는 SAVE_BATCH 문장마다 저장한다. 중간에 끊겨도 앞서 만든 음성은 남고, 다시 할 때 남은 문장만 만든다(2026-11-10 점검)."""
    import pytest

    from app.mq.envelope import Envelope

    monkeypatch.setattr(tts, "SAVE_BATCH", 2)
    saved: list[int] = []

    class Con:
        async def execute(self, sql, *args):
            if sql.startswith("UPDATE description_lines"):
                saved.append(args[2])

        def transaction(self):
            return self

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

    class Pool:
        async def fetchval(self, sql, *args):
            return "YOUTUBE" if "source_type" in sql else 1

        async def fetchrow(self, sql, *args):
            return {"summary_text": None, "summary_audio_key": None}

        async def fetch(self, sql, *args):
            if "transcript_segments" in sql:
                return []
            return [{"id": i, "line_index": i, "text": f"문장 {i}.", "start_ms": i * 1000, "detail_level": 1} for i in range(1, 6)]

        def acquire(self):
            return Con()

    class Db:
        pool = Pool()

    batches = []

    async def many(gms, storage, items, ctx, on_done=None, inf=None):
        batches.append([x[0] for x in items])
        if len(batches) == 2:
            raise TimeoutError("시간 제한")
        return {x[0]: 100 for x in items}

    monkeypatch.setattr(tts, "synthesize_many", many)

    class Events:
        async def started(self):
            pass

        async def progress(self, pct):
            pass

        async def completed(self, result, progress=None):
            pass

    env = Envelope(messageId="t", type="JOB_TTS", jobId=1, payload={"descriptionId": 1})
    with pytest.raises(TimeoutError):
        await tts.Tts(LocalStorage(str(tmp_path)), None, Db())(env, Events())
    assert saved == [1, 2]  # 첫 묶음은 저장됐다


def test_dub_line_is_told_apart_like_be_dublines():
    """외국어 대사 번역 문장(상세도 1, '이름: ' 뗀 글이 그 시각 대사 안에 있음)만 남성 목소리로 읽는다(BE DubLines와 같은 규칙)."""
    spoken = [(461_000, 462_000, "신사숙녀여러분!"), (491_000, 526_000, "총독각하의건배사입니다.금일쇼와7년")]
    assert tts.is_dub(461_000, 1, "일본 고위 관리: 신사 숙녀 여러분!", spoken)
    assert tts.is_dub(495_000, 1, "금일 쇼와 7년", spoken)  # 긴 연설이 나뉜 뒤쪽 문장
    assert not tts.is_dub(461_000, 2, "신사 숙녀 여러분!", spoken)  # 해설 상세도
    assert not tts.is_dub(463_000, 1, "훈장을 단 남성이 마이크 앞에 선다.", spoken)
    assert not tts.is_dub(600_000, 1, "신사 숙녀 여러분!", spoken)  # 대사 끝 + 15초 지남


async def test_dub_voice_is_cached_apart_from_narration_voice(monkeypatch, tmp_path):
    voices = []

    async def synth(gms, text, ctx, voice=tts.VOICE_NAME):
        voices.append(voice)
        return b"ID3" + voice.encode(), 900

    monkeypatch.setattr(tts, "synthesize", synth)
    storage, ctx = LocalStorage(str(tmp_path)), CallContext("TTS", job_id=1)
    await tts.synthesize_many(None, storage, [("tts/1/1-a.mp3", "건배!"), ("tts/1/2-b.mp3", "건배!", tts.DUB_VOICE)], ctx)
    assert sorted(voices) == sorted([tts.VOICE_NAME, tts.DUB_VOICE])  # 같은 문장이라도 목소리가 다르면 따로 만든다
    assert (tmp_path / "tts/1/2-b.mp3").read_bytes() == b"ID3" + tts.DUB_VOICE.encode()


async def test_upload_dub_line_uses_cast_supertonic_voice(monkeypatch, tmp_path):
    """업로드 영상: 해설은 F1, 배역이 Supertonic 목소리인 대사는 그 목소리. GPU 서버가 끊겨 Gemini로 만들 땐 배역 대신 DUB_VOICE."""
    voices = []

    class Inf(inference.MockInference):
        async def tts(self, text, voice):
            voices.append(voice)
            return b"ID3super", 500

    storage, ctx = LocalStorage(str(tmp_path)), CallContext("TTS", job_id=1)
    items = [("tts/1/1-a.mp3", "요정이 웃습니다.", tts.VOICE_NAME), ("tts/1/2-b.mp3", "기적도 시간이 걸려요.", "F3")]
    await tts.synthesize_many(None, storage, items, ctx, inf=Inf())
    assert sorted(voices) == ["F1", "F3"]

    gemini = []

    async def synth(gms, text, ctx, voice=tts.VOICE_NAME):
        gemini.append(voice)
        return b"ID3gemini", 100

    monkeypatch.setattr(tts, "synthesize", synth)
    await tts.synthesize_many(None, storage, [("tts/2/3-c.mp3", "처음 듣는 대사예요.", "M2")], ctx)
    assert gemini == [tts.DUB_VOICE]
