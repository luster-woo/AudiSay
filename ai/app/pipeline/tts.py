"""job.tts / line.tts — 해설 음성 (워커 메시지 명세 7·8장, 진행률 80→100).

- job.tts: 상세도 1·2 문장 전부 + 30초 요약을 Gemini TTS(목소리 Kore)로 만들어 S3에 올리고
  description_lines.audio_key·audio_duration_ms, descriptions.summary_audio_key·summary_duration_ms를 채운다.
  payload(BE TtsPayload): {descriptionId, voiceCode("ko-female-1")} — 목소리가 하나뿐이라 voiceCode는 읽지 않는다.
  PROGRESS는 80→100을 10% 단위(90)로 보내고, 완료 result에 descriptionId를 넣는다(BE TtsResult가 그 값만 읽음).
  해설 공개(PUBLISHED·READY)는 BE가 TTS 완료 이벤트를 받고 한다(descriptionService.publish) → 여기서는 하지 않는다.
- line.tts: 사용자가 상세도 3을 처음 고를 때 BE가 보낸다. payload.lineIds가 있으면 그 문장만, 없으면 detailLevel(기본 3) 문장 중
  음성이 없는 것 전부.
- 한 문장이 실패하면 그 문장만 비워 둔다(FE가 브라우저 음성으로 읽음). 모델은 gemini-3.8-flash-tts → 실패하면 lite.
- 문장만 보낸다(지시문을 붙이면 그것까지 읽음). PCM 24kHz 16bit mono → ffmpeg로 mp3(64k). Dockerfile에 ffmpeg 필요.
- clean_tail: SDK 응답 끝에 붙는 0.1~0.3초 최대 음량 잡음("칙")을 잘라 낸다(데모 troubleshooting 6번).

데모 backend/app/pipeline/tts.py(synthesize_many·clean_tail)를 비동기·S3로 옮겼다. voice_code 칼럼은 V3에서 지워져 쓰지 않는다.

같은 문장은 음성을 다시 만들지 않는다(크레딧 재사용, 2026-11-02): 문장 글의 해시로 S3 cache/tts/kore/{해시}.mp3 →
레포에 넣어 둔 데모 음성 ai/data/tts/{해시}.mp3(index.json에 길이) 순서로 찾고, 없을 때만 Gemini TTS를 부른 뒤 캐시에 남긴다.
데모와 같은 모델·목소리(gemini-3.8-flash-tts, Kore)·형식(mp3)이고, 팀 merge도 문장 글을 바꾸지 않아 글이 같으면 그대로 쓴다.
"""
import asyncio
import hashlib
import logging
from array import array
from collections.abc import Awaitable, Callable
from pathlib import Path

from google.genai import types

from app.db import Db
from app.errors import WorkerError
from app.gms.client import CallContext, GmsClient
from app.mq.envelope import Envelope
from app.mq.worker import Events
from app.storage import Storage

log = logging.getLogger(__name__)

MODELS = ("gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts")
VOICE_NAME = "Kore"
CONCURRENCY = 5
PRE_TTS_LEVEL = 2  # job.tts가 미리 만드는 상세도. 3은 line.tts
STAGE_START_PROGRESS, STAGE_END_PROGRESS = 80, 100
PROGRESS_STEP = 10  # PROGRESS 이벤트는 10% 단위로(노션 워커 메시지 명세 7·9장)
MP3_BITRATE = "64k"
TTS_SEED_DIR = Path(__file__).resolve().parents[2] / "data" / "tts"  # 데모에서 만든 음성(이미지에 함께 들어감)
_seed_index: dict[str, int] | None = None

SR = 24000  # Gemini TTS PCM: 24kHz 16bit mono
WIN = SR // 50  # 20ms 창
QUIET, LOUD = 300, 8000


def line_key(description_id: int, line_id: int, text: str) -> str:
    """워커 메시지 명세 7장: tts/{descriptionId}/{lineId}-{짧은 해시}.mp3. 문장이 고쳐지면 새 이름이라 옛 음성이 새 문장을 덮지 않는다."""
    return f"tts/{description_id}/{line_id}-{hashlib.sha1(text.encode()).hexdigest()[:8]}.mp3"


def summary_key(description_id: int) -> str:
    return f"tts/summary/{description_id}.mp3"


def clean_tail(pcm: bytes) -> bytes:
    """말이 끝난 뒤 조용하다가 갑자기 붙는 큰 잡음을 잘라 낸다.

    진짜 말은 끝에서 조용해지는데 이 잡음은 파일 맨 끝까지 크게 이어진다. 그래서 '파일이 큰 소리로 끝나면' 마지막 1초 안에서
    조용한 창이 3개(60ms) 이상 이어진 마지막 구간을 찾아 그 시작 + 80ms에서 자르고 10ms 페이드아웃한다. 조용하게 끝나는 파일은 그대로.
    """
    s = array("h")
    s.frombytes(pcm[: len(pcm) - len(pcm) % 2])
    n = len(s)
    peaks = [max(map(abs, s[i:i + WIN]), default=0) for i in range(0, n, WIN)]
    if not peaks or peaks[-1] < LOUD:
        return pcm
    start = max(0, len(peaks) - SR // WIN)  # 마지막 1초만 본다
    cut = None
    run = 0
    for i in range(start, len(peaks)):
        if peaks[i] < QUIET:
            run += 1
        else:
            if run >= 3:
                cut = (i - run) * WIN + 4 * WIN
            run = 0
    if cut is None:
        return pcm
    s = s[:min(cut, n)]
    fade = min(len(s), SR // 100)
    for k in range(fade):
        s[len(s) - fade + k] = int(s[len(s) - fade + k] * (fade - k) / fade)
    return s.tobytes()


def duration_ms(pcm: bytes) -> int:
    return int(len(pcm) / (SR * 2 / 1000))


async def encode_mp3(pcm: bytes) -> bytes:
    """PCM(24kHz 16bit mono) → mp3 바이트. ffmpeg가 PATH에 있어야 한다."""
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-loglevel", "error", "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", "pipe:0",
        "-b:a", MP3_BITRATE, "-f", "mp3", "pipe:1",
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    out, err = await proc.communicate(pcm)
    if proc.returncode != 0 or not out:
        raise WorkerError("TRANSCODE_FAILED", f"ffmpeg mp3 변환 실패: {err.decode(errors='replace')[:300]}")
    return out


def _config() -> types.GenerateContentConfig:
    return types.GenerateContentConfig(
        response_modalities=["AUDIO"],
        speech_config=types.SpeechConfig(voice_config=types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=VOICE_NAME))))


def _pcm(r: types.GenerateContentResponse) -> bytes:
    for c in r.candidates or []:
        for p in (c.content.parts if c.content else None) or []:
            if p.inline_data and p.inline_data.data:
                return p.inline_data.data
    return b""


async def synthesize(gms: GmsClient, text: str, ctx: CallContext) -> tuple[bytes, int] | None:
    """문장 하나 → (mp3 바이트, 길이 ms). 두 모델 다 실패하면 None."""
    for model in MODELS:
        try:
            r = await gms.generate(model, text, _config(), ctx, retries=1)
        except Exception as e:  # noqa: BLE001 — 다음 모델로
            log.warning("TTS 실패 %s: %s", model, str(e)[:200])
            continue
        pcm = _pcm(r)
        if not pcm:
            continue
        pcm = clean_tail(pcm)
        return await encode_mp3(pcm), duration_ms(pcm)
    return None


def text_hash(text: str) -> str:
    import hashlib

    return hashlib.sha1(text.strip().encode()).hexdigest()[:16]


def tts_cache_key(h: str) -> str:
    return f"cache/tts/kore/{h}.mp3"


def _seed(h: str) -> tuple[bytes, int] | None:
    global _seed_index
    if _seed_index is None:
        idx = TTS_SEED_DIR / "index.json"
        import json

        _seed_index = json.loads(idx.read_text(encoding="utf-8")) if idx.exists() else {}
    p = TTS_SEED_DIR / f"{h}.mp3"
    return (p.read_bytes(), int(_seed_index.get(h) or 0)) if h in _seed_index and p.exists() else None


async def reuse(storage: Storage, text: str) -> tuple[bytes, int] | None:
    """같은 문장의 음성(mp3, 길이 ms): S3 캐시 → 레포의 데모 음성. 없으면 None."""
    h = text_hash(text)
    key = tts_cache_key(h)
    if await storage.exists(key):
        meta_key = key.removesuffix(".mp3") + ".json"
        meta = await storage.get_json(meta_key) if await storage.exists(meta_key) else {}
        return await storage.get_bytes(key), int(meta.get("durationMs") or 0)
    return _seed(h)


async def remember(storage: Storage, text: str, mp3: bytes, ms: int) -> None:
    key = tts_cache_key(text_hash(text))
    await storage.put_bytes(key, mp3, "audio/mpeg")
    await storage.put_json(key.removesuffix(".mp3") + ".json", {"durationMs": ms})


OnDone = Callable[[int, int], Awaitable[None]]


async def synthesize_many(gms: GmsClient, storage: Storage, items: list[tuple[str, str]], ctx: CallContext,
                          on_done: OnDone | None = None) -> dict[str, int | None]:
    """items: [(S3 키, 문장)]. 동시에 CONCURRENCY개씩. 반환 {키: 길이 ms 또는 None(실패)}."""
    sem = asyncio.Semaphore(CONCURRENCY)
    out: dict[str, int | None] = {}

    async def one(key: str, text: str) -> None:
        async with sem:
            made = await reuse(storage, text)  # 같은 문장이면 크레딧 0
            if made is None:
                made = await synthesize(gms, text, ctx)
                if made:
                    await remember(storage, text, *made)
            if made:
                await storage.put_bytes(key, made[0], "audio/mpeg")
            out[key] = made[1] if made else None
        if on_done:
            await on_done(len(out), len(items))

    await asyncio.gather(*(one(k, t) for k, t in items))
    return out


class Tts:
    """job.tts: 상세도 1·2 문장 + 요약."""

    def __init__(self, storage: Storage, gms: GmsClient, db: Db):
        self.storage, self.gms, self.db = storage, gms, db

    async def __call__(self, env: Envelope, events: Events) -> None:
        p, job_id = env.payload, env.jobId
        pool = _pool(self.db)
        desc_id = await _description_id(pool, p, job_id)
        d = await pool.fetchrow("SELECT summary_text, summary_audio_key FROM descriptions WHERE id = $1", desc_id)
        rows = await pool.fetch("SELECT id, text FROM description_lines WHERE description_id = $1 AND detail_level <= $2"
                                " AND audio_key IS NULL ORDER BY line_index", desc_id, PRE_TTS_LEVEL)
        await events.started()
        items = [(line_key(desc_id, r["id"], r["text"]), r["text"]) for r in rows]
        if d["summary_text"] and not d["summary_audio_key"]:
            items.append((summary_key(desc_id), d["summary_text"]))

        sent = STAGE_START_PROGRESS

        async def progress(n: int, total: int) -> None:
            nonlocal sent
            pct = progress_step(n, total)
            if sent < pct < STAGE_END_PROGRESS:  # 10% 경계를 넘을 때만(80 → 90). 100은 완료 이벤트가 전한다
                sent = pct
                await events.progress(pct)

        done = await synthesize_many(self.gms, self.storage, items, CallContext("TTS", job_id=job_id), progress) if items else {}
        async with pool.acquire() as con, con.transaction():
            for r in rows:
                key = line_key(desc_id, r["id"], r["text"])
                if done.get(key):
                    # 그 사이 관리자가 문장을 고쳤으면 옛 음성으로 덮지 않는다(명세 7·8장 WHERE id = ? AND text = ?)
                    await con.execute("UPDATE description_lines SET audio_key = $1, audio_duration_ms = $2, updated_at = NOW()"
                                      " WHERE id = $3 AND text = $4", key, done[key], r["id"], r["text"])
            skey = summary_key(desc_id)
            if done.get(skey):
                await con.execute("UPDATE descriptions SET summary_audio_key = $1, summary_duration_ms = $2 WHERE id = $3",
                                  skey, done[skey], desc_id)
        ok = sum(1 for v in done.values() if v)
        log.info("tts 완료 job=%s description=%s 음성 %s/%s", job_id, desc_id, ok, len(items))
        await events.completed({"descriptionId": desc_id, "audioMade": ok, "audioTotal": len(items),
                                "failedKeys": [k for k, v in done.items() if not v]}, progress=STAGE_END_PROGRESS)


class LineTts:
    """line.tts: 상세도 3(또는 지정한 문장)의 음성을 나중에 만든다. 진행률 이벤트는 보내지 않고 완료만 보낸다."""

    def __init__(self, storage: Storage, gms: GmsClient, db: Db):
        self.storage, self.gms, self.db = storage, gms, db

    async def __call__(self, env: Envelope, events: Events) -> None:
        p = env.payload
        pool = _pool(self.db)
        desc_id = int(p["descriptionId"])
        if p.get("lineIds"):
            rows = await pool.fetch("SELECT id, text FROM description_lines WHERE description_id = $1 AND id = ANY($2::bigint[])"
                                    " AND audio_key IS NULL ORDER BY line_index", desc_id, [int(x) for x in p["lineIds"]])
        else:
            rows = await pool.fetch("SELECT id, text FROM description_lines WHERE description_id = $1 AND detail_level = $2"
                                    " AND audio_key IS NULL ORDER BY line_index", desc_id, int(p.get("detailLevel") or 3))
        items = [(line_key(desc_id, r["id"], r["text"]), r["text"]) for r in rows]
        done = await synthesize_many(self.gms, self.storage, items, CallContext("TTS", job_id=env.jobId)) if items else {}
        async with pool.acquire() as con, con.transaction():
            for r in rows:
                key = line_key(desc_id, r["id"], r["text"])
                if done.get(key):
                    # 그 사이 관리자가 문장을 고쳤으면 옛 음성으로 덮지 않는다(명세 7·8장 WHERE id = ? AND text = ?)
                    await con.execute("UPDATE description_lines SET audio_key = $1, audio_duration_ms = $2, updated_at = NOW()"
                                      " WHERE id = $3 AND text = $4", key, done[key], r["id"], r["text"])
        ok = sum(1 for v in done.values() if v)
        log.info("line.tts 완료 description=%s 음성 %s/%s", desc_id, ok, len(items))
        if env.jobId is not None:  # 작업에 묶인 메시지일 때만 job.events로 알린다
            await events.completed({"descriptionId": desc_id, "audioMade": ok, "audioTotal": len(items)})


def _pool(db: Db):
    if db.pool is None:
        raise WorkerError("UNKNOWN", "DB에 연결되어 있지 않아 음성 정보를 저장할 수 없습니다")
    return db.pool


async def _description_id(pool, p: dict, job_id: int | None) -> int:
    """payload.descriptionId가 있으면 그것, 없으면 jobId로 descriptions를 찾는다."""
    if p.get("descriptionId") is not None:
        desc_id = int(p["descriptionId"])
        if await pool.fetchval("SELECT 1 FROM descriptions WHERE id = $1", desc_id):
            return desc_id
        raise WorkerError("UNKNOWN", f"descriptions {desc_id}가 없습니다", retryable=False)
    desc_id = await pool.fetchval("SELECT id FROM descriptions WHERE job_id = $1", job_id)
    if desc_id is None:
        raise WorkerError("UNKNOWN", f"job {job_id}의 해설이 없습니다(job.merge 결과 없음)")
    return desc_id


def progress_step(n: int, total: int) -> int:
    """n/total → 80~100을 10% 단위로 내림(0/10 → 80, 5/10 → 90, 10/10 → 100)."""
    if total <= 0:
        return STAGE_END_PROGRESS
    pct = STAGE_START_PROGRESS + (STAGE_END_PROGRESS - STAGE_START_PROGRESS) * n / total
    return int(pct // PROGRESS_STEP * PROGRESS_STEP)
