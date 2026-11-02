"""Spring → AI 서버 내부 API (명세서 > AI 서버 내부 명세서). 재생 중 챗봇은 RabbitMQ 없이 Spring이 HTTP로 바로 부른다.

FE는 부르지 않고, nginx에도 연결하지 않는다. X-Internal-Token 헤더로 확인한다(없거나 틀리면 401). 응답은 본문만,
실패하면 HTTP 상태와 {"code","message"}(main.py 오류 처리기가 detail을 벗겨 냄). chat_logs는 Spring이 저장하고 AI는 읽기만 한다.

1. /internal/chat/intent(명세 2번) 응답 {intent, slots}
   - intent: QUESTION / SCENE_NOW / SEEK_TIME / SEEK_SCENE / SETTING / ACTION / UNKNOWN
   - slots: SEEK_TIME {targetMs}, SEEK_SCENE {query}, SETTING {settingKey(detailLevel|speechRate|subtitleReading), settingValue},
     ACTION {actionCode(PLAY|PAUSE|WHERE|SUMMARY)}, 나머지 {}
   - 규칙 → H200(INTENT_TIMEOUT초) → gemini-3.1-flash-lite. Spring 제한 5초. chat_logs는 Spring이 저장한다.
2. /internal/chat/seek(명세 3번): Spring이 chapters.keywords로 못 찾았을 때만 부른다. {descriptionId, query}
   → gemini-3.8-flash가 목차 제목·요약·키워드를 보고 0~3개 → {candidates:[{chapterId, title, startMs, summary}]}.
   GMS가 없으면(개발) 키워드 점수 상위 3개. 목차가 없으면 빈 배열.
3. /internal/chat/answer(명세 4번): text/event-stream. Spring은 이벤트를 바꾸지 않고 FE로 넘기고 done 값으로 chat_logs를 저장한다.
   - event: delta    {text}                      새로 나온 글(지금은 문장 단위)
   - event: sentence {text, audioUrl}            문장마다 gemini-3.8-flash-tts(Kore) → S3 tts/chat/{chatLogId}/{n}.mp3(1번부터) →
                                                 presigned 6시간. TTS가 실패하면 audioUrl null(FE 브라우저 음성)
   - event: done     {answerText, answerSource(STORED|UNANSWERABLE), firstAudioMs, totalLatencyMs}
   - event: error    {errorCode, message}         (공개 API 명세와 같은 이름)
   - Spring이 연결을 끊으면 거기까지로 끝낸다. 같은 chatLogId가 처리 중이면 409 CHAT_IN_PROGRESS(Redis 잠금 120초).
   - 자료: 앞 장면·지금 장면(제목·해설 문장), 입력 시각 앞 60초 대사, 화면 글자, 30초 요약. 뒤 대사는 넣지 않는다.
4. /internal/stt(명세 1번): multipart `audio`(webm/ogg/mp4/wav, 60초·10MB 이하) + 선택 `videoId`
   → ffmpeg 16kHz wav → H200 faster-whisper(크레딧 0, STT_TIMEOUT초) → 못 받으면 GMS whisper-1(language=ko).
   videoId가 있으면 영상 제목·인물 이름·목차 단어를 받아쓰기 힌트(prompt)로 넣는다. Spring 제한 10초 안에 끝나게 시간을 나눈다.
   응답 {text, latencyMs, engine:"H200"|"GMS"}. 오류: 422 STT_EMPTY(아무 말도 인식 안 됨), 400 STT_FORMAT(빈 녹음·10MB 초과·
   디코딩 실패), 502 GMS_ERROR(둘 다 꺼짐·실패).
5. 오류 응답 형식: 본문 {code, message}만(공통 응답 봉투·detail 없음). 요청 형식 오류는 400 INVALID_REQUEST.
6. /internal/tts(공개 /api/v1/tts용, 명세 밖 추가): 안내 목소리 한 문장 {text, voice(F1~F5·M1~M5, 기본 F1)}
   → H200 Supertonic 3(크레딧 0, 문장당 약 0.04초) → S3 audio/guide/{voice}/{해시}.mp3(같은 문장은 저장본) → presigned 6시간.
   응답 {audioUrl, audioKey, durationMs, cached, latencyMs}. 만들지 못하면 200 + audioUrl null·reason(TTS_002 H200 꺼짐,
   TTS_003 실패) → Spring은 그대로 넘기고 FE는 브라우저 음성으로 읽는다. 빈 문장만 400 TTS_001.
   숫자·영어는 한국어 읽기로 바꾸고 ▶·🅰 같은 기호·이모지는 지운 뒤 만든다(app/tts_text.py).

AI 순서(크레딧 0을 먼저): 규칙·저장된 자료 → H200 오픈소스(INFERENCE_MODE=remote, H200_CHAT에 든 기능만) → GMS.
명세의 Spring 제한 시간(stt 10초, intent 5초, seek 10초, answer 첫 이벤트 10초·전체 60초) 안에 끝나게 H200은 짧게 기다린다.

필요한 것: app.state.db(Db), app.state.gms(GmsClient), app.state.redis — main.py에서 넣는다.
의존성 추가: python-multipart(파일 업로드), httpx(whisper 호출). Dockerfile에 ffmpeg.
"""
import asyncio
import hashlib
import hmac
import json
import logging
import re
import time

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app import inference
from app.chat import answer as ans
from app.chat import intent as it
from app.chat import seek as sk
from app.config import settings
from app.db import CallLog
from app.tts_text import normalize_ko

log = logging.getLogger(__name__)

ANSWER_LOCK_SEC = 120  # 같은 chatLogId 답변 중복 막기(Spring 전체 제한 60초보다 넉넉히)
ANSWER_AUDIO_URL_SEC = 6 * 3600  # 답변 음성 presigned 주소 6시간(명세)
TTS_VOICES = {f"{g}{i}" for g in "FM" for i in range(1, 6)}  # Supertonic 3 목소리(gpu_server와 같음)
TTS_MAX_CHARS = 500
TTS_AUDIO_URL_SEC = 6 * 3600  # 안내 음성 presigned 주소(답변 음성과 같게 6시간)
STT_MAX_BYTES = 10 * 1024 * 1024
WHISPER_TIMEOUT = 5  # GMS whisper-1(PoC 1.0~2.6초). H200 STT_TIMEOUT과 합쳐 Spring 제한 10초 안
STT_HINT_CHARS = 400  # whisper prompt는 224토큰까지
_answering: set[int] = set()  # Redis가 없을 때(개발) 처리 중인 chatLogId


def require_token(x_internal_token: str = Header(default="")) -> None:
    expected = settings().ai_internal_token
    if not expected or not hmac.compare_digest(x_internal_token, expected):
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED", "message": "내부 토큰이 맞지 않습니다"})


router = APIRouter(prefix="/internal", dependencies=[Depends(require_token)])


class IntentRequest(BaseModel):
    videoId: int | None = None
    descriptionId: int | None = None
    videoTimeMs: int | None = None
    utterance: str


class SeekRequest(BaseModel):
    descriptionId: int
    query: str
    chatLogId: int | None = None


class AnswerRequest(BaseModel):
    chatLogId: int
    descriptionId: int
    videoTimeMs: int
    utterance: str
    intent: str  # QUESTION | SCENE_NOW


class TtsRequest(BaseModel):
    text: str
    voice: str = "F1"


def _err(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def _pool(request: Request):
    db = getattr(request.app.state, "db", None)
    if db is None or db.pool is None:
        raise _err(503, "DB_UNAVAILABLE", "DB에 연결되어 있지 않습니다")
    return db.pool


def _gms(request: Request):
    """GMS 키가 없으면 None(개발용: 규칙·저장된 자료로만 답한다)."""
    cfg = settings()
    if not cfg.gms_api_key or not cfg.gms_gemini_base_url:
        return None
    return getattr(request.app.state, "gms", None)


def answer_lock_key(chat_log_id: int) -> str:
    return f"chat:answer:lock:{chat_log_id}"


def chat_audio_key(chat_log_id: int, n: int) -> str:
    return f"tts/chat/{chat_log_id}/{n}.mp3"


# ---------- 발화 분석 ----------

@router.post("/chat/intent")
async def intent(req: IntentRequest, request: Request) -> dict:
    t0 = time.monotonic()
    duration_ms = 0
    if req.descriptionId is not None:
        row = await _pool(request).fetchrow("SELECT v.duration_sec FROM descriptions d JOIN videos v ON v.id = d.video_id"
                                            " WHERE d.id = $1", req.descriptionId)
        if row:
            duration_ms = int(row["duration_sec"]) * 1000
    p = it.by_rules(req.utterance, duration_ms, req.videoTimeMs or 0)
    inf = inference.for_chat(settings(), "intent")
    if p is None and inf:
        p = await it.by_remote(inf, req.utterance, getattr(request.app.state, "db", None))  # H200(크레딧 0). 실패하면 None
    if p is None:
        gms = _gms(request)
        p = await it.by_ai(gms, req.utterance) if gms else it.Parsed("QUESTION", by="RULE")
    log.info("발화 분석 %s by=%s %dms", p.intent, p.by, int((time.monotonic() - t0) * 1000))
    return {"intent": p.intent, "slots": slots_of(p)}


def slots_of(p: "it.Parsed") -> dict:
    """명세의 intent별 slots. 규칙·AI 결과(Parsed)를 옮긴다."""
    if p.intent == "SEEK_TIME":
        return {"targetMs": p.targetMs}
    if p.intent == "SEEK_SCENE":
        return {"query": p.sceneQuery}
    if p.intent == "SETTING" and p.setting:
        key, value = next(iter(p.setting.items()))
        return {"settingKey": key, "settingValue": value}
    if p.intent == "ACTION":
        return {"actionCode": p.action}
    return {}


# ---------- 말로 장면 찾기 ----------

@router.post("/chat/seek")
async def seek(req: SeekRequest, request: Request) -> dict:
    """Spring이 키워드로 못 찾은 장면을 AI가 0~3개 고른다. GMS가 없으면(개발) 키워드 점수 상위 3개."""
    chapters = await sk.chapters_of(_pool(request), req.descriptionId)
    if not chapters:
        return {"candidates": []}
    gms = _gms(request)
    picked = await sk.by_ai(gms, req.query, chapters, req.chatLogId) if gms else sk.by_keywords(req.query, chapters)[:3]
    return {"candidates": [{k: c[k] for k in ("chapterId", "title", "startMs", "summary")} for c in picked]}


# ---------- 질문 답변 ----------

@router.post("/chat/answer")
async def answer(req: AnswerRequest, request: Request) -> StreamingResponse:
    """질문 답변을 SSE로 흘려보낸다(명세 4번). Spring은 이벤트를 바꾸지 않고 FE로 넘기고 done으로 chat_logs를 저장한다."""
    if req.intent not in ("QUESTION", "SCENE_NOW"):
        raise _err(400, "CHAT_002", "답변할 질문이 아닙니다")
    pool = _pool(request)
    if not await _lock_answer(request, req.chatLogId):
        raise _err(409, "CHAT_IN_PROGRESS", "같은 질문의 답변을 만들고 있어요")
    gms, inf = _gms(request), inference.for_chat(settings(), "answer")
    db, storage = getattr(request.app.state, "db", None), request.app.state.storage
    return StreamingResponse(_answer_events(request, pool, gms, inf, db, storage, req), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def _lock_answer(request: Request, chat_log_id: int) -> bool:
    """같은 chatLogId가 처리 중이면 False(409). Redis가 없으면(개발) 이 프로세스 안에서만 막는다."""
    redis = getattr(request.app.state, "redis", None)
    if redis is not None:
        return bool(await redis.set(answer_lock_key(chat_log_id), "1", nx=True, ex=ANSWER_LOCK_SEC))
    if chat_log_id in _answering:
        return False
    _answering.add(chat_log_id)
    return True


async def _unlock_answer(request: Request, chat_log_id: int) -> None:
    redis = getattr(request.app.state, "redis", None)
    if redis is not None:
        await redis.delete(answer_lock_key(chat_log_id))
    _answering.discard(chat_log_id)


async def _answer_events(request: Request, pool, gms, inf, db, storage, req: AnswerRequest):
    """delta(새로 나온 글) → sentence(문장 하나, 음성 주소) … → done. 실패하면 error. Spring이 끊으면 거기까지로 끝낸다."""
    t0 = time.monotonic()
    texts: list[str] = []
    first_audio_ms: int | None = None
    try:
        ctx = await ans.context(pool, req.descriptionId, req.videoTimeMs)
        chapters = await sk.chapters_of(pool, req.descriptionId)
        sentences = await _pick_answer(gms, req, ctx, inf, db)
        async for s in _with_hint(sentences, req, chapters):
            if await request.is_disconnected():
                log.info("답변 중 연결 끊김 chatLog=%s(%d문장까지)", req.chatLogId, len(texts))
                break
            yield sse("delta", {"text": s})
            audio_url = await _sentence_audio(gms, storage, req.chatLogId, len(texts) + 1, s)  # 1번부터(명세 예시 tts/chat/88/1.mp3)
            if audio_url and first_audio_ms is None:
                first_audio_ms = int((time.monotonic() - t0) * 1000)
            yield sse("sentence", {"text": s, "audioUrl": audio_url})
            texts.append(s)
        answer_text = " ".join(texts)
        source = "UNANSWERABLE" if ans.UNANSWERABLE in answer_text else "STORED"
        yield sse("done", {"answerText": answer_text, "answerSource": source, "firstAudioMs": first_audio_ms,
                           "totalLatencyMs": int((time.monotonic() - t0) * 1000)})
    except Exception as e:  # noqa: BLE001
        log.exception("답변 실패 chatLog=%s", req.chatLogId)
        yield sse("error", {"errorCode": getattr(e, "code", "UNKNOWN"), "message": "답변을 만들지 못했어요. 잠시 뒤 다시 물어봐 주세요."})
    finally:
        await _unlock_answer(request, req.chatLogId)


async def _sentence_audio(gms, storage, chat_log_id: int, n: int, text: str) -> str | None:
    """문장 음성: gemini-3.8-flash-tts(Kore) → S3 tts/chat/{chatLogId}/{n}.mp3 → presigned 6시간. 실패하면 None(브라우저 음성)."""
    if gms is None:
        return None
    from app.gms.client import CallContext
    from app.pipeline import tts as tts_pipe

    try:
        made = await tts_pipe.synthesize(gms, text, CallContext("TTS", chat_log_id=chat_log_id))
        if not made:
            return None
        key = chat_audio_key(chat_log_id, n)
        await storage.put_bytes(key, made[0], "audio/mpeg")
        return await storage.presign(key, ANSWER_AUDIO_URL_SEC)
    except Exception as e:  # noqa: BLE001 — 음성이 없어도 글로 답한다
        log.warning("답변 음성 실패 chatLog=%s #%s: %s", chat_log_id, n, str(e)[:200])
        return None


async def _pick_answer(gms, req: AnswerRequest, ctx: dict, inf=None, db=None):
    """문장 비동기 반복자. 저장된 자료 → H200 → GMS(gemini-3.1-flash-lite) → AI 없음 순서."""
    if req.intent == "SCENE_NOW":
        return _aiter(ans.scene_now(ctx))
    direct = ans.character_answer(req.utterance, ctx)
    if direct:
        return _aiter(direct)
    if inf:
        remote = await ans.remote_answer(inf, req.utterance, ctx, db, req.chatLogId)
        if remote:
            return remote
    if gms:
        return ans.answer_sentences(gms, req.utterance, ctx, req.chatLogId)
    return _aiter(ans.no_ai_answer(req.utterance, ctx))


async def _aiter(items):
    for x in items:
        yield x


async def _with_hint(sentences, req: AnswerRequest, chapters: list[dict]):
    """'자료에 없어요'로 끝나면 다른 장면에 있는 내용인지 보고 그 장면으로 안내하는 문장을 덧붙인다."""
    last = None
    async for s in sentences:
        last = s
        yield s
    if last and re.search(r"자료에.*없", last):
        hint = sk.far_scene_hint(req.utterance, chapters, req.videoTimeMs)
        if hint:
            yield hint


# ---------- 받아쓰기 ----------

@router.post("/stt")
async def stt(request: Request, audio: UploadFile = File(...), videoId: int | None = Form(None)) -> dict:
    """브라우저 녹음 → ffmpeg 16kHz mono wav → H200 faster-whisper → 못 받으면 GMS whisper-1(language=ko)."""
    raw = await audio.read()
    if not raw:
        raise _err(400, "STT_FORMAT", "녹음된 소리가 없어요.")
    if len(raw) > STT_MAX_BYTES:
        raise _err(400, "STT_FORMAT", "녹음이 너무 길어요. 60초 안으로 말해 주세요.")
    cfg = settings()
    has_gms = bool(cfg.gms_api_key and cfg.gms_gemini_base_url)
    inf = inference.for_chat(cfg, "stt")
    if not has_gms and not inf:
        raise _err(502, "GMS_ERROR", "음성 인식이 꺼져 있어요. 글자로 입력해 주세요.")
    try:
        wav = await _to_wav16k(raw)
    except Exception:  # noqa: BLE001
        raise _err(400, "STT_FORMAT", "녹음 파일을 읽지 못했어요. 다시 말해 주세요.") from None
    t0 = time.monotonic()
    db = getattr(request.app.state, "db", None)
    hint = await _stt_hint(request, videoId)
    text, engine = None, None
    if inf:  # H200 faster-whisper(크레딧 0)
        try:
            r = await inf.transcribe_bytes(wav, hint)
            text, engine = " ".join(s["text"] for s in r.get("segments", []) if s.get("text")).strip(), "H200"
            await inference.log_remote(db, "STT", str(r.get("model", "")), t0)
        except inference.InferenceError as e:
            await inference.log_remote(db, "STT", "unknown", t0, error=e.code)
            text = None
    if text is None and has_gms:
        try:
            text, engine = await _whisper(cfg, wav, hint), "GMS"
        except Exception as e:  # noqa: BLE001
            if db:
                await db.log_call(CallLog(purpose="STT", model="whisper-1", latency_ms=int((time.monotonic() - t0) * 1000),
                                          error_code="AI_UNAVAILABLE"))
            log.warning("whisper 실패(videoId=%s): %s", videoId, str(e)[:200])
        else:
            if db:
                await db.log_call(CallLog(purpose="STT", model="whisper-1", latency_ms=int((time.monotonic() - t0) * 1000)))
    if text is None:
        raise _err(502, "GMS_ERROR", "음성 인식 서버에 연결하지 못했어요. 글자로 입력해 주세요.")
    if not text:
        raise _err(422, "STT_EMPTY", "말을 알아듣지 못했어요. 다시 말해 주세요.")
    return {"text": text, "latencyMs": int((time.monotonic() - t0) * 1000), "engine": engine}


async def _stt_hint(request: Request, video_id: int | None) -> str:
    """받아쓰기 힌트: 영상 제목·인물 이름·목차 단어(공개된 해설 기준). 고유명사 인식을 높인다. DB가 없으면 빈 글."""
    db = getattr(request.app.state, "db", None)
    if video_id is None or db is None or db.pool is None:
        return ""
    try:
        row = await db.pool.fetchrow("SELECT v.title, d.id AS did FROM videos v LEFT JOIN descriptions d ON d.video_id = v.id"
                                     " AND d.status = 'PUBLISHED' WHERE v.id = $1 ORDER BY d.id DESC LIMIT 1", video_id)
        if not row:
            return ""
        parts = [row["title"] or ""]
        if row["did"]:
            names = await db.pool.fetch("SELECT name FROM characters WHERE description_id = $1 AND name IS NOT NULL", row["did"])
            words = await db.pool.fetch("SELECT title, keywords FROM chapters WHERE description_id = $1 ORDER BY chapter_index",
                                        row["did"])
            parts.append(", ".join(r["name"] for r in names))
            parts.append(", ".join(w for r in words for w in [r["title"], *(r["keywords"] or [])] if w))
        return ". ".join(p for p in parts if p)[:STT_HINT_CHARS]
    except Exception as e:  # noqa: BLE001 — 힌트가 없어도 받아쓰기는 한다
        log.warning("받아쓰기 힌트 실패 video=%s: %s", video_id, e)
        return ""


async def _to_wav16k(raw: bytes) -> bytes:
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-loglevel", "error", "-i", "pipe:0", "-ac", "1", "-ar", "16000", "-acodec", "pcm_s16le", "-f", "wav", "pipe:1",
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    out, err = await proc.communicate(raw)
    if proc.returncode != 0 or not out:
        raise RuntimeError(err.decode(errors="replace")[:300])
    return out


def openai_base(gemini_base_url: str) -> str:
    """GMS Gemini 주소(…/gmsapi/generativelanguage.googleapis.com)에서 OpenAI 경로를 만든다."""
    return gemini_base_url.split("/gmsapi/")[0] + "/gmsapi/api.openai.com/v1"


async def _whisper(cfg, wav: bytes, hint: str = "") -> str:
    import httpx

    data = {"model": "whisper-1", "language": "ko", **({"prompt": hint} if hint else {})}
    async with httpx.AsyncClient(timeout=WHISPER_TIMEOUT) as client:
        r = await client.post(f"{openai_base(cfg.gms_gemini_base_url)}/audio/transcriptions",
                              headers={"Authorization": f"Bearer {cfg.gms_api_key}"},
                              data=data, files={"file": ("q.wav", wav, "audio/wav")})
        r.raise_for_status()
    return (r.json().get("text") or "").strip()


# ---------- 안내 목소리 ----------

def tts_key(text: str, voice: str) -> str:
    return f"audio/guide/{voice}/{hashlib.sha1(text.encode()).hexdigest()[:16]}.mp3"


@router.post("/tts")
async def tts(req: TtsRequest, request: Request) -> dict:
    """안내 목소리 한 문장 → H200 Supertonic → S3 mp3 → presigned 주소. 같은 문장·목소리는 저장본(해시 키)을 다시 쓴다.
    공개 API(/api/v1/tts)처럼 만들지 못하면 오류 대신 audioUrl null(FE 브라우저 음성). 빈 문장만 400."""
    text = normalize_ko(req.text)[:TTS_MAX_CHARS]
    if not text:
        raise _err(400, "TTS_001", "읽을 문장이 없어요.")
    voice = req.voice if req.voice in TTS_VOICES else "F1"
    key = tts_key(text, voice)
    meta_key = key.removesuffix(".mp3") + ".json"
    storage = request.app.state.storage
    t0 = time.monotonic()

    async def made(duration_ms: int | None, cached: bool) -> dict:
        return {"audioUrl": await storage.presign(key, TTS_AUDIO_URL_SEC), "audioKey": key, "durationMs": duration_ms,
                "cached": cached, "latencyMs": int((time.monotonic() - t0) * 1000)}

    def missing(reason: str) -> dict:
        return {"audioUrl": None, "audioKey": None, "durationMs": None, "cached": False, "reason": reason,
                "latencyMs": int((time.monotonic() - t0) * 1000)}

    if await storage.exists(key):
        meta = await storage.get_json(meta_key) if await storage.exists(meta_key) else {}
        return await made(meta.get("durationMs"), True)
    inf = inference.for_chat(settings(), "tts")
    if not inf:
        return missing("TTS_002")  # H200 꺼짐
    db = getattr(request.app.state, "db", None)
    try:
        audio, ms = await inf.tts(text, voice)
    except inference.InferenceError as e:
        await inference.log_remote(db, "TTS", "supertonic", t0, error=e.code)
        return missing("TTS_003")  # H200 실패
    await storage.put_bytes(key, audio, "audio/mpeg")
    await storage.put_json(meta_key, {"durationMs": ms, "voice": voice, "text": text})
    await inference.log_remote(db, "TTS", "supertonic", t0)
    return await made(ms, False)
