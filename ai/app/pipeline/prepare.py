"""job.prepare — 영상 준비 (워커 메시지 명세 2장, AI 화면해설 파이프라인 명세서 2.1).

GEMINI_URL(유튜브): 영상을 내려받지 않고 Gemini에 유튜브 주소를 한 번 넘겨 영상 전체 해설
(대사·장면·화면 글자·인물·누적형 해설 문장·30초 요약·카테고리)을 받아 jobs/{jobId}/full.json에 저장한다.
조각 구간과 조각별 앞 내용 요약은 jobs/{jobId}/prepare.json에 저장한다.
제목에 따라 장르 지침(시리즈 등장인물 사전·요리)을 프롬프트에 붙인다(pipeline/prompts.py, 데모 검증).

LOCAL(업로드): S3 원본을 받아 H200 오픈소스 모델로 나눠 분석하고(pipeline/local.py), 유튜브와 같은 full.json을 만든다.
재생용 MP4는 playback/{videoId}.mp4에 올리고 결과 playbackKey로 알린다. 그 뒤 describe·merge·tts는 유튜브와 같다.
"""
import asyncio
import json
import logging
import tempfile
import time
from pathlib import Path

from google.genai import types

from app import inference
from app.config import settings
from app.errors import WorkerError
from app.gms.client import CallContext, GmsClient
from app.mq.envelope import Envelope
from app.mq.worker import Events
from app.pipeline import local, prompts
from app.pipeline.narration_schema import CATEGORY_CODE, IMPORTANCE_CODE, PROMPT, Narration, to_ms
from app.storage import Storage

log = logging.getLogger(__name__)

LONG_VIDEO_SEC = 180  # 3분 이상은 gemini-3.5-flash, 숏츠는 gemini-3.8-flash (PoC 결정)
MODEL_LONG, MODEL_SHORT = "gemini-3.5-flash", "gemini-3.8-flash"
STAGE_END_PROGRESS = 20  # 진행률 범위 PREPARE 0~20
CUT_SEARCH_RATIO = 0.25  # 조각 경계는 목표 시각 앞뒤 chunkSec의 25% 안에서 장면 경계·대사 틈을 찾는다
MIN_LAST_CHUNK_RATIO = 0.3  # 마지막 조각이 chunkSec의 30%보다 짧으면 앞 조각에 붙인다
CONTEXT_TITLES = 5  # 앞 내용 요약에 넣는 직전 장면 제목 수


def pick_model(duration_sec: int | None) -> str:
    return MODEL_LONG if (duration_sec or 0) >= LONG_VIDEO_SEC else MODEL_SHORT


def normalize(raw: dict, video_id: int | None, model: str, duration_ms: int | None) -> dict:
    """Gemini 응답(MM:SS 문자열)을 밀리초로 바꾸고 정렬한 full.json 형식으로 만든다."""
    dialogues = [{"startMs": to_ms(d["start"]), "endMs": to_ms(d["end"]), "speaker": d.get("speaker"),
                  "text": d["text"], **({"original": d["original"]} if d.get("original") else {})} for d in raw["dialogue"]]
    scenes = [{
        "startMs": to_ms(s["start"]), "endMs": to_ms(s["end"]), "title": s["title"],
        "people": [{"name": p.get("name"), "basis": p.get("basis"), "appearance": p["appearance"]}
                   for p in s.get("people", [])],
        "screenTexts": [{"text": t["text"], "textType": t.get("text_type", "OTHER"),
                         "importance": IMPORTANCE_CODE.get(t["importance"], "MEDIUM"),
                         "sameAsDialogue": bool(t.get("same_as_dialogue"))} for t in s.get("screen_text", [])],
    } for s in raw["scenes"]]
    lines = [{"atMs": to_ms(x["at"]), "detailLevel": min(3, max(1, int(x["level"]))), "text": x["text"].strip()}
             for x in raw["lines"] if x.get("text", "").strip()]

    ends = [x["endMs"] for x in dialogues + scenes] + [x["atMs"] for x in lines]
    if not duration_ms:
        duration_ms = max(ends, default=0)
    for x in dialogues + scenes:  # 영상 길이를 넘는 시각은 잘라 둔다
        x["startMs"], x["endMs"] = min(x["startMs"], duration_ms), min(x["endMs"], duration_ms)
    for x in lines:
        x["atMs"] = min(x["atMs"], duration_ms)

    dialogues.sort(key=lambda x: x["startMs"])
    scenes.sort(key=lambda x: x["startMs"])
    lines.sort(key=lambda x: (x["atMs"], x["detailLevel"]))
    return {"version": 1, "videoId": video_id, "model": model, "durationMs": duration_ms,
            "category": CATEGORY_CODE.get(raw["category"], "ETC"), "summary30s": raw["summary_30s"],
            "dialogues": dialogues, "scenes": scenes, "lines": lines, "dialogueLanguage": raw.get("dialogue_language")}


def _inside_dialogue(t: int, dialogues: list[dict]) -> dict | None:
    return next((d for d in dialogues if d["startMs"] < t < d["endMs"]), None)


def make_chunks(full: dict, chunk_sec: int) -> list[dict]:
    """chunkSec 단위로 나누되, 가능하면 장면 경계나 대사 사이에서 자른다."""
    duration, step = full["durationMs"], max(10, chunk_sec) * 1000
    dialogues = full["dialogues"]
    window = int(step * CUT_SEARCH_RATIO)
    candidates = sorted({s["startMs"] for s in full["scenes"]} | {d["endMs"] for d in dialogues})
    candidates = [c for c in candidates if not _inside_dialogue(c, dialogues)]

    cuts, target = [], step
    while target < duration:
        near = [c for c in candidates if abs(c - target) <= window and c > (cuts[-1] if cuts else 0)]
        cut = min(near, key=lambda c: abs(c - target)) if near else target
        d = _inside_dialogue(cut, dialogues)
        if d:
            cut = d["endMs"]
        if duration - cut < step * MIN_LAST_CHUNK_RATIO:
            break
        cuts.append(cut)
        target = cut + step

    bounds = [0] + cuts + [duration]
    chunks = []
    for i in range(len(bounds) - 1):
        start, end = bounds[i], bounds[i + 1]
        titles = [s["title"] for s in full["scenes"] if s["startMs"] < start][-CONTEXT_TITLES:]
        chunks.append({"chunkIndex": i, "startMs": start, "endMs": end,
                       "contextSummary": " / ".join(titles) if titles else None})
    return chunks


class Prepare:
    def __init__(self, storage: Storage, gms: GmsClient, inf: "inference.Inference | None" = None, db=None):
        self.storage, self.gms, self.db = storage, gms, db
        self.inf = inf if inf is not None else inference.MockInference()

    async def __call__(self, env: Envelope, events: Events) -> None:
        p, job_id = env.payload, env.jobId
        full_key, prep_key = f"jobs/{job_id}/full.json", f"jobs/{job_id}/prepare.json"

        if await self.storage.exists(prep_key):  # 중복 메시지: 결과가 있으면 완료 이벤트만 다시 보낸다
            prep = await self.storage.get_json(prep_key)
            await events.completed(self._result(prep_key, prep), progress=STAGE_END_PROGRESS)
            return

        pipeline = p.get("pipeline")
        if pipeline == "GEMINI_URL" and not p.get("youtubeUrl"):
            raise WorkerError("VIDEO_UNAVAILABLE", "youtubeUrl이 없습니다")
        if pipeline == "LOCAL" and not p.get("originalKey"):
            raise WorkerError("VIDEO_UNAVAILABLE", "originalKey가 없습니다")
        if pipeline not in ("GEMINI_URL", "LOCAL"):
            raise WorkerError("UNKNOWN", f"아직 지원하지 않는 pipeline: {pipeline}", retryable=False)

        await events.started()
        duration_sec = p.get("durationSec")
        playback = None
        if await self.storage.exists(full_key):
            full = await self.storage.get_json(full_key)
            playback = full.get("playbackKey")
        elif pipeline == "LOCAL":
            full = await self._analyze_upload(env, events)
            playback = full["playbackKey"]
            await self.storage.put_json(full_key, full)
        else:
            full = await self._describe_video(env, events, duration_sec)
            await self.storage.put_json(full_key, full)

        prep = {"category": full["category"], "summary30s": full["summary30s"], "model": full["model"],
                "playbackKey": playback, "chunks": make_chunks(full, int(p.get("chunkSec") or 120))}
        await self.storage.put_json(prep_key, prep)
        log.info("prepare 완료 job=%s 조각 %s개, 문장 %s개", job_id, len(prep["chunks"]), len(full["lines"]))
        await events.completed(self._result(prep_key, prep), progress=STAGE_END_PROGRESS)

    async def _describe_video(self, env: Envelope, events: Events, duration_sec: int | None) -> dict:
        p = env.payload
        model = pick_model(duration_sec)
        cfg = types.GenerateContentConfig(response_mime_type="application/json", response_schema=Narration,
                                          temperature=0.2, thinking_config=types.ThinkingConfig(thinking_budget=0))
        prompt, series = prompts.build_prompt(PROMPT, p.get("title"))  # 장르 지침(시리즈 등장인물 사전·요리)
        if series:
            log.info("시리즈 등장인물 사전 사용 job=%s: %s", env.jobId, series)
        contents = types.Content(parts=[types.Part(file_data=types.FileData(file_uri=p["youtubeUrl"])),
                                        types.Part(text=prompt)])
        ticker = asyncio.create_task(_progress_ticker(events, duration_sec))
        t0 = time.monotonic()
        try:
            r = await self.gms.generate(model, contents, cfg, CallContext("DESCRIBE", job_id=env.jobId))
        finally:
            ticker.cancel()
        try:
            raw = json.loads(r.text)
            Narration.model_validate(raw)
        except Exception as e:  # noqa: BLE001 - 형식이 깨진 응답은 다시 부르면 대개 고쳐진다
            raise WorkerError("UNKNOWN", f"Gemini 응답 형식 오류: {e}") from e
        full = normalize(raw, p.get("videoId"), model, (duration_sec or 0) * 1000 or None)
        log.info("Gemini 전체 해설 job=%s %s %.0f초", env.jobId, model, time.monotonic() - t0)
        return full

    async def _analyze_upload(self, env: Envelope, events: Events) -> dict:
        """LOCAL: S3 원본 → 임시 폴더에서 재생용 파일·분석 → full.json(+playbackKey, dialogueLanguage). 진행률 2~19."""
        p, job_id = env.payload, env.jobId
        video_id = int(p["videoId"])
        cfg = settings()
        has_gms = bool(cfg.gms_api_key and cfg.gms_gemini_base_url)

        async def progress(pct: int) -> None:
            await events.progress(min(pct, STAGE_END_PROGRESS - 1))

        with tempfile.TemporaryDirectory(prefix=f"audisay-{job_id}-") as tmp:
            work = Path(tmp)
            original = work / ("original" + Path(p["originalKey"]).suffix)
            await self.storage.download_file(p["originalKey"], original)
            await progress(2)
            files = await asyncio.to_thread(local.make_files, original, work)
            await self.storage.upload_file(local.playback_key(video_id), files["playback"], "video/mp4")
            await self.storage.upload_file(local.thumb_key(video_id), files["thumb"], "image/jpeg")
            await progress(4)
            duration_ms = int(round(files["durationSec"] * 1000))
            t0 = time.monotonic()
            raw, model, errors = await local.analyze(cfg.upload_engine, self.inf, self.gms, has_gms, p.get("title"), files, work,
                                                     duration_ms, progress, job_id, self.db)
        full = normalize(raw, video_id, model, duration_ms)
        full["playbackKey"] = local.playback_key(video_id)
        full["thumbnailKey"] = local.thumb_key(video_id)
        full["engineErrors"] = errors
        log.info("업로드 분석 job=%s %s %.0f초 장면 %s개 문장 %s개 대체=%s", job_id, model, time.monotonic() - t0,
                 len(full["scenes"]), len(full["lines"]), errors or "없음")
        return full

    @staticmethod
    def _result(prep_key: str, prep: dict) -> dict:
        return {"resultKey": prep_key, "category": prep["category"], "playbackKey": prep.get("playbackKey"), "audioKey": None,
                "chunks": prep["chunks"]}


async def _progress_ticker(events: Events, duration_sec: int | None) -> None:
    """Gemini 한 번 호출은 중간 진행률이 없어서, 예상 시간(12분 영상 약 110초)에 맞춰 5·10·15%를 보낸다."""
    expected = max(20.0, (duration_sec or 60) * 0.15)
    for pct in (5, 10, 15):
        await asyncio.sleep(expected / 4)
        await events.progress(pct)
