"""Spring → AI 서버 내부 API (API 명세서 > AI 서버 내부 API). **제안 구현** — 데모 backend/app/api/chat.py의 흐름을 옮겼다.

FE는 부르지 않고, nginx에도 연결하지 않는다. X-Internal-Token 헤더로 확인한다(팀 require_token 그대로).

===== BE와 합의 필요 =====
1. /internal/chat/intent 응답 형식(데모와 같음):
   {intent, targetMs, sceneQuery, setting{detailLevel|speechRate|subtitleReading}, action(PLAY|PAUSE|WHERE|SUMMARY),
    by(RULE|AI), relativeMs, needsAnswer(bool), latencyMs}
   - SEEK_SCENE이면 BE가 이어서 /internal/chat/seek을 부른다(여기서는 장면을 찾지 않는다). 데모는 한 번에 했다.
   - BE가 chat_logs.intent·intent_latency_ms를 쓴다(AI는 chat_logs를 읽기만 — 요청에 chatLogId가 없기 때문).
2. /internal/chat/seek 응답: {chapter{chapterId,title,startMs}|null, targetMs|null, candidates[{chapterId,title,startMs}], by(KEYWORD|AI|NONE)}
   - chapter가 null이고 candidates가 2개 이상이면 FE가 후보를 읽어 주고 고르게 한다(데모 동작). BE가 chat_logs.target_ms·target_chapter_id를 쓴다.
3. /internal/chat/answer: 202로 바로 응답 {chatLogId, redisKey, status:"STARTED"}. 답변은 Redis 리스트 chat:answer:{chatLogId}에
   문장 하나가 완성될 때마다 RPUSH(JSON 한 줄). BE가 BLPOP/LRANGE로 읽어 SSE로 FE에 보낸다(architecture.md 4장).
   - 원소: {"event":"sentence","index":0,"text":"...","audioUrl":null,"source":"STORED|GEMINI"}
            {"event":"done","answerText":"...","answerSource":"STORED|GEMINI_REQUERY|UNANSWERABLE"}
            {"event":"error","code":"...","message":"..."}
   - 키 TTL 10분(ANSWER_KEY_TTL_SEC). BLPOP으로 읽으면 리스트가 비므로 다시 열 수 없다 → 다시 열기가 필요하면 LRANGE로 바꾼다.
   - 답변 음성(audioUrl)은 지금 null(FE 브라우저 음성). 데모는 Supertonic(로컬 TTS)을 썼는데 팀 결정 전(README '못 정한 것').
   - chat_logs.answer_text·answer_source·first_audio_ms·total_latency_ms는 AI가 쓴다(데모와 같음). BE가 쓰기로 하면 _finish_log를 뺀다.
4. /internal/stt: multipart `audio`(webm/ogg/wav, 10MB 이하) → ffmpeg 16kHz wav → H200 faster-whisper(크레딧 0) → 실패하면 GMS whisper-1.
   응답 {text, engine:"H200"|"GMS", latencyMs}.
   오류: 400 STT_001(빈 녹음)·STT_002(10MB 초과)·STT_005(디코딩 실패), 422 STT_004(알아듣지 못함), 503 STT_003(둘 다 꺼짐)·STT_006(둘 다 실패).
5. 오류 응답 형식: HTTPException detail={code, message} (팀 require_token과 같은 모양).

AI 순서(데모와 같음, 크레딧 0을 먼저): 규칙·저장된 자료 → H200 오픈소스(INFERENCE_MODE=remote, H200_CHAT에 든 기능만) → GMS.
answer의 source는 STORED|H200|GEMINI, chat_logs.answer_source는 H200·GEMINI 둘 다 GEMINI_REQUERY(팀 ERD 값).

필요한 것: app.state.db(Db), app.state.gms(GmsClient), app.state.redis — main.py에서 넣는다.
의존성 추가: python-multipart(파일 업로드), httpx(whisper 호출). Dockerfile에 ffmpeg.
"""
import asyncio
import hmac
import json
import logging
import re
import time
from typing import Any

from fastapi import APIRouter, Depends, File, Header, HTTPException, Request, UploadFile
from pydantic import BaseModel

from app import inference
from app.chat import answer as ans
from app.chat import intent as it
from app.chat import seek as sk
from app.config import settings
from app.db import CallLog

log = logging.getLogger(__name__)

ANSWER_KEY_TTL_SEC = 600
STT_MAX_BYTES = 10 * 1024 * 1024
_background: set[asyncio.Task] = set()  # 답변 작업이 GC로 사라지지 않게 붙들어 둔다


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


def answer_key(chat_log_id: int) -> str:
    return f"chat:answer:{chat_log_id}"


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
    return {**p.dict(), "needsAnswer": p.intent in ("QUESTION", "SCENE_NOW"),
            "latencyMs": int((time.monotonic() - t0) * 1000)}


# ---------- 말로 장면 찾기 ----------

@router.post("/chat/seek")
async def seek(req: SeekRequest, request: Request) -> dict:
    chapters = await sk.chapters_of(_pool(request), req.descriptionId)
    if not chapters:
        raise _err(404, "SEEK_001", "이 해설에는 장면 목차가 없습니다")
    candidates = sk.by_keywords(req.query, chapters)
    chapter, by = sk.pick(candidates), "KEYWORD"
    if chapter is None and not candidates:
        gms = _gms(request)
        if gms:
            chapter, by = await sk.by_ai(gms, req.query, chapters, req.chatLogId), "AI"
    brief = lambda c: {k: c[k] for k in ("chapterId", "title", "startMs")}  # noqa: E731
    return {"chapter": brief(chapter) if chapter else None, "targetMs": chapter["startMs"] if chapter else None,
            "candidates": [brief(c) for c in candidates] if not chapter else [], "by": by if chapter else "NONE"}


# ---------- 질문 답변 ----------

@router.post("/chat/answer", status_code=202)
async def answer(req: AnswerRequest, request: Request) -> dict:
    """바로 202를 돌려주고, 답변은 Redis 리스트 chat:answer:{chatLogId}에 문장마다 밀어 넣는다."""
    if req.intent not in ("QUESTION", "SCENE_NOW"):
        raise _err(400, "CHAT_002", "답변할 질문이 아닙니다")
    pool = _pool(request)
    redis = request.app.state.redis
    task = asyncio.create_task(_run_answer(pool, redis, _gms(request), req, inference.for_chat(settings(), "answer"),
                                           getattr(request.app.state, "db", None)))
    _background.add(task)
    task.add_done_callback(_background.discard)
    return {"chatLogId": req.chatLogId, "redisKey": answer_key(req.chatLogId), "status": "STARTED"}


async def _run_answer(pool, redis, gms, req: AnswerRequest, inf=None, db=None) -> None:
    key, t0 = answer_key(req.chatLogId), time.monotonic()

    async def push(obj: dict[str, Any]) -> None:
        await redis.rpush(key, json.dumps(obj, ensure_ascii=False))
        await redis.expire(key, ANSWER_KEY_TTL_SEC)

    texts: list[str] = []
    first_ms: int | None = None
    try:
        ctx = await ans.context(pool, req.descriptionId, req.videoTimeMs)
        chapters = await sk.chapters_of(pool, req.descriptionId)
        sentences, source = await _pick_answer(gms, req, ctx, inf, db)
        async for s in _with_hint(sentences, texts, req, chapters):
            texts.append(s)
            if first_ms is None:
                first_ms = int((time.monotonic() - t0) * 1000)
            await push({"event": "sentence", "index": len(texts) - 1, "text": s, "audioUrl": None, "source": source})
        answer_text = " ".join(texts)
        db_source = "UNANSWERABLE" if ans.UNANSWERABLE in answer_text else (
            "GEMINI_REQUERY" if source in ("GEMINI", "H200") else "STORED")
        await _finish_log(pool, req.chatLogId, answer_text, db_source, first_ms, t0)
        await push({"event": "done", "answerText": answer_text, "answerSource": db_source})
    except Exception as e:  # noqa: BLE001
        log.exception("답변 실패 chatLog=%s", req.chatLogId)
        await push({"event": "error", "code": getattr(e, "code", "UNKNOWN"),
                    "message": "답변을 만들지 못했어요. 잠시 뒤 다시 물어봐 주세요."})


async def _pick_answer(gms, req: AnswerRequest, ctx: dict, inf=None, db=None):
    """(문장 비동기 반복자, 어디서 답했나). 저장된 자료 → H200 → GMS → AI 없음 순서."""
    if req.intent == "SCENE_NOW":
        return _aiter(ans.scene_now(ctx)), "STORED"
    direct = ans.character_answer(req.utterance, ctx)
    if direct:
        return _aiter(direct), "STORED"
    if inf:
        remote = await ans.remote_answer(inf, req.utterance, ctx, db, req.chatLogId)
        if remote:
            return remote, "H200"
    if gms:
        return ans.answer_sentences(gms, req.utterance, ctx, req.chatLogId), "GEMINI"
    return _aiter(ans.no_ai_answer(req.utterance, ctx)), "STORED"


async def _aiter(items):
    for x in items:
        yield x


async def _with_hint(sentences, texts: list[str], req: AnswerRequest, chapters: list[dict]):
    """'자료에 없어요'로 끝나면 다른 장면에 있는 내용인지 보고 그 장면으로 안내하는 문장을 덧붙인다."""
    last = None
    async for s in sentences:
        last = s
        yield s
    if last and re.search(r"자료에.*없", last):
        hint = sk.far_scene_hint(req.utterance, chapters, req.videoTimeMs)
        if hint:
            yield hint


async def _finish_log(pool, chat_log_id: int, answer_text: str, source: str, first_ms: int | None, t0: float) -> None:
    try:
        await pool.execute("UPDATE chat_logs SET answer_text = $1, answer_source = $2, first_audio_ms = $3, total_latency_ms = $4"
                           " WHERE id = $5", answer_text, source, first_ms, int((time.monotonic() - t0) * 1000), chat_log_id)
    except Exception as e:  # noqa: BLE001 — 기록 실패로 답변을 막지 않는다
        log.warning("chat_logs 갱신 실패 %s: %s", chat_log_id, e)


# ---------- 받아쓰기 ----------

@router.post("/stt")
async def stt(request: Request, audio: UploadFile = File(...)) -> dict:
    """브라우저 녹음 → ffmpeg 16kHz mono wav → GMS whisper-1(language=ko)."""
    raw = await audio.read()
    if not raw:
        raise _err(400, "STT_001", "녹음된 소리가 없어요.")
    if len(raw) > STT_MAX_BYTES:
        raise _err(400, "STT_002", "녹음이 너무 길어요. 30초 안으로 말해 주세요.")
    cfg = settings()
    has_gms = bool(cfg.gms_api_key and cfg.gms_gemini_base_url)
    inf = inference.for_chat(cfg, "stt")
    if not has_gms and not inf:
        raise _err(503, "STT_003", "음성 인식이 꺼져 있어요. 글자로 입력해 주세요.")
    try:
        wav = await _to_wav16k(raw)
    except Exception:  # noqa: BLE001
        raise _err(400, "STT_005", "녹음 파일을 읽지 못했어요. 다시 말해 주세요.") from None
    t0 = time.monotonic()
    db = getattr(request.app.state, "db", None)
    text, engine = None, None
    if inf:  # H200 faster-whisper(크레딧 0)
        try:
            r = await inf.transcribe_bytes(wav)
            text, engine = " ".join(s["text"] for s in r.get("segments", []) if s.get("text")).strip(), "H200"
            await inference.log_remote(db, "STT", str(r.get("model", "")), t0)
        except inference.InferenceError as e:
            await inference.log_remote(db, "STT", "unknown", t0, error=e.code)
            text = None
    if text is None and has_gms:
        try:
            text, engine = await _whisper(cfg, wav), "GMS"
        except Exception as e:  # noqa: BLE001
            if db:
                await db.log_call(CallLog(purpose="STT", model="whisper-1", latency_ms=int((time.monotonic() - t0) * 1000),
                                          error_code="AI_UNAVAILABLE"))
            log.warning("whisper 실패: %s", str(e)[:200])
        else:
            if db:
                await db.log_call(CallLog(purpose="STT", model="whisper-1", latency_ms=int((time.monotonic() - t0) * 1000)))
    if text is None:
        raise _err(503, "STT_006", "음성 인식 서버에 연결하지 못했어요. 글자로 입력해 주세요.")
    if not text:
        raise _err(422, "STT_004", "말을 알아듣지 못했어요. 다시 말해 주세요.")
    return {"text": text, "engine": engine, "latencyMs": int((time.monotonic() - t0) * 1000)}


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


async def _whisper(cfg, wav: bytes) -> str:
    import httpx

    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(f"{openai_base(cfg.gms_gemini_base_url)}/audio/transcriptions",
                              headers={"Authorization": f"Bearer {cfg.gms_api_key}"},
                              data={"model": "whisper-1", "language": "ko"}, files={"file": ("q.wav", wav, "audio/wav")})
        r.raise_for_status()
    return (r.json().get("text") or "").strip()
