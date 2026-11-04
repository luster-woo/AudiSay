"""업로드 영상(LOCAL)의 job.prepare: 영상 파일을 직접 나눠 분석해 유튜브와 **같은 full.json**을 만든다.

데모에서 검증한 흐름을 그대로 옮겼다(데모 backend/app/pipeline/upload.py + local_pipeline.py + upload_gemini.py).
바꾼 것은 팀 환경에 맞춘 부분뿐이다: 파일은 S3(원본 받기·재생용 올리기)와 임시 폴더, AI 호출은 비동기(팀 GmsClient·
inference.RemoteInference), 결과는 SQLite 대신 full.json/prepare.json(그 뒤 describe·merge·tts는 유튜브와 같은 코드).

흐름(오픈소스 엔진, 기본)
1. S3 원본(uploads/{videoId}/original.*) → 임시 폴더. ffprobe로 길이·코덱 확인
2. 재생용 MP4(H.264면 재포장, 아니면 변환) → S3 playback/{videoId}.mp4, 받아쓰기용 16kHz wav, 썸네일 → uploads/{videoId}/thumb.jpg
3. 동시에: 장면 나누기(PySceneDetect, 이 서버 CPU) + 장면별 대표 사진 / H200 받아쓰기(faster-whisper, 언어 자동) → 외국어면 번역
4. H200 화면 글자(PaddleOCR) → H200 장면 해설(Qwen3-VL, 사진+대사+글자) → 개조식 끝 고치기·문장 수 줄이기 → H200 요약
5. Gemini 응답과 같은 모양(raw)으로 모아 prepare.normalize → full.json
H200이 실패하면 Gemini 엔진(영상 파일을 Gemini에 넣음, 크레딧)으로, UPLOAD_ENGINE=gemini면 그 반대 순서.
"""
import asyncio
import json
import logging
import re
import subprocess
import time
from pathlib import Path

from google.genai import types

from app import inference
from app.errors import WorkerError
from app.gms.client import CallContext, GmsClient
from app.pipeline import prompts
from app.pipeline import translate_fix as tf
from app.pipeline.narration_schema import PROMPT, Narration

log = logging.getLogger(__name__)

# ---------- 1·2. 파일 준비(데모 upload.py) ----------

MAX_SEC = 60 * 60  # 팀 명세: 시각장애인 60분. H200 분석은 영상 길이의 약 1.4배 걸림(12분 영상 약 17분)


def playback_key(video_id: int) -> str:
    return f"playback/{video_id}.mp4"  # 워커 메시지 명세 1장 "오래 두는 파일"


def thumb_key(video_id: int) -> str:
    return f"uploads/{video_id}/thumb.jpg"


def probe(path: Path) -> dict:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise WorkerError("TRANSCODE_FAILED", "영상 파일을 읽지 못했어요(ffprobe 실패)")
    j = json.loads(r.stdout)
    streams = j.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if not video:
        raise WorkerError("TRANSCODE_FAILED", "영상이 들어 있지 않은 파일이에요")
    duration = float(j.get("format", {}).get("duration") or video.get("duration") or 0)
    return {"durationSec": duration, "videoCodec": video.get("codec_name"), "audioCodec": audio.get("codec_name") if audio else None,
            "formatName": j.get("format", {}).get("format_name", ""), "width": video.get("width"), "height": video.get("height")}


def _ff(*args: str) -> None:
    r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], capture_output=True, text=True)
    if r.returncode != 0:
        raise WorkerError("TRANSCODE_FAILED", f"ffmpeg 실패: {r.stderr[:300]}")


def make_files(original: Path, work: Path) -> dict:
    """재생용 MP4·16kHz 음성·썸네일을 work 폴더에 만든다."""
    info = probe(original)
    if info["durationSec"] <= 0:
        raise WorkerError("DURATION_MISMATCH", "영상 길이를 알 수 없어요")
    if info["durationSec"] > MAX_SEC:
        raise WorkerError("DURATION_MISMATCH", f"영상이 {MAX_SEC // 60}분보다 길어요")
    playback = work / "playback.mp4"
    simple = "mp4" in info["formatName"] and info["videoCodec"] == "h264" and info["audioCodec"] in ("aac", None)
    if simple:  # 변환 없이 재포장(빠름)
        _ff("-i", str(original), "-c", "copy", "-movflags", "+faststart", str(playback))
    else:
        _ff("-i", str(original), "-vf", "scale='min(1280,iw)':-2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(playback))
    wav = None
    if info["audioCodec"]:
        wav = work / "audio16k.wav"
        _ff("-i", str(playback), "-vn", "-ac", "1", "-ar", "16000", str(wav))
    thumb = work / "thumb.jpg"
    _ff("-ss", str(min(1.0, info["durationSec"] / 2)), "-i", str(playback), "-frames:v", "1", "-vf", "scale=480:-2", str(thumb))
    return {**info, "remuxed": simple, "playback": playback, "wav": wav, "thumb": thumb}


def frames(playback: Path, work: Path, scenes: list[dict], per_scene=4) -> list[list[Path]]:
    """장면마다 대표 프레임 n장. per_scene은 숫자 또는 (장면 길이 ms → 장 수) 함수."""
    out_dir = work / "frames"
    out_dir.mkdir(parents=True, exist_ok=True)
    result = []
    for i, s in enumerate(scenes):
        a, b = s["startMs"] / 1000, s["endMs"] / 1000
        paths = []
        n = per_scene(s["endMs"] - s["startMs"]) if callable(per_scene) else per_scene
        for k in range(n):
            t = a + (b - a) * (k + 0.5) / n
            p = out_dir / f"s{i:03d}_{n}_{k}.jpg"
            if not p.exists():
                _ff("-ss", f"{t:.2f}", "-i", str(playback), "-frames:v", "1", "-vf", "scale=768:-2", "-q:v", "4", str(p))
            paths.append(p)
        result.append(paths)
    return result


# ---------- 3·4. 오픈소스 분석(데모 local_pipeline.py) ----------

MIN_SCENE_SEC = 4.0  # 2초였을 때 2분 요리 영상이 25장면(평균 5초)으로 잘게 나뉨
MAX_SCENE_SEC = 30.0  # 장면이 너무 길면 나눠서 해설이 듬성듬성해지지 않게

# 추론 서버에 함께 보내는 해설 지침. 첫 실분석(2026-10-28)에서 "표시됨"처럼 개조식으로 끝나는 문장이 섞여 넣었다
STYLE_GUIDE = ("누적형 해설(level 1~3). 화면에 보이는 것만 쓰고 대사를 반복하지 않습니다. "
               "모든 문장은 \"~합니다\", \"~있습니다\", \"~입니다\"처럼 현재형으로 끝나는 완결된 문장으로 씁니다. "
               "\"표시됨\", \"구성됨\", \"있음\"처럼 명사형으로 끝내지 않습니다. 한 문장 40자 안팎. "
               "문장 수는 장면 길이에 맞춥니다: 6초에 1문장 정도, level 1은 장면마다 1문장. "
               "숫자·표·그래프의 값은 화면 글자에 적힌 대로 정확히 읽습니다.")

FOREIGN_GUIDE = (" 이 영상의 대사는 외국어라 이용자가 알아듣지 못합니다. 주어진 대사는 한국어로 옮긴 것입니다. "
                 "대사와 화면 글자에 나오는 핵심 정보(재료 이름과 분량, 조리 순서, 불 세기·시간, 사람이 설명하는 요점)는 "
                 "'대사를 반복하지 않는다'는 규칙의 예외로, 해설 문장에 한국어로 담습니다(예: 커리 잎 10장과 커리 가루 1큰술을 준비합니다). "
                 "영어 화면 글자는 한국어로 옮겨 씁니다. 재료·물건 이름은 주어진 대사 번역에 나온 한국어 이름을 그대로 씁니다"
                 "(대사가 '말린 생선 가루'면 해설도 '말린 생선 가루'. 따로 옮기면 해설과 대사 번역이 달라져 헷갈립니다).")

# 개조식 끝맺음 → 완결 문장(gpu_server/server.py의 finish_sentence와 같아야 함). 서버가 옛 버전이어도 여기서 한 번 더 고친다
ENDINGS = [(re.compile(r"(있|없)음$"), r"\1습니다"), (re.compile(r"됨$"), "됩니다"), (re.compile(r"함$"), "합니다"),
           (re.compile(r"임$"), "입니다"), (re.compile(r"(있|없)다$"), r"\1습니다")]


def finish_sentence(text: str) -> str:
    """"표시됨", "있음" 같은 개조식 끝을 "~됩니다/~있습니다"로 바꾸고 마침표를 붙인다. 이미 완결 문장이면 마침표만 맞춘다."""
    t = text.strip().rstrip(".。 ")
    if not t:
        return ""
    if not re.search(r"(니다|요|세요|까|죠|[.?!])$", t):
        for pat, rep in ENDINGS:
            if pat.search(t):
                t = pat.sub(rep, t)
                break
    return t if t[-1] in "?!" else t + "."


def overlaps(seg: dict, scene: dict) -> bool:
    """대사 묶음이 장면과 겹치는가. 문장으로 묶은 대사(최대 12초)가 앞 장면에서 시작해도 이 장면에 넘겨 준다."""
    return seg["startMs"] < scene["endMs"] and seg["endMs"] > scene["startMs"]


def frames_for(scene_ms: int) -> int:
    """장면 길이에 맞춘 대표 사진 수: 6초에 1장, 4~8장."""
    return max(4, min(8, round(scene_ms / 6000)))


SEC_PER_LINE = 6.0  # 장면 길이 몇 초에 문장 하나(모든 상세도 합). 해설 읽기 약 3~4초 + 대사·여유


def cap_lines(lines: list[dict], scene_ms: int) -> list[dict]:
    """장면 길이에 비해 문장이 너무 많으면 줄인다. level 1은 한도의 절반까지(최소 1), 나머지는 낮은 level(중요한 것)부터 남긴다.
    모델이 짧은 장면에도 문장을 3~5개씩 써서 2분 영상이 115문장이 된 문제(2026-10-29)."""
    limit = max(1, round(scene_ms / 1000 / SEC_PER_LINE))
    seen: set[str] = set()
    uniq = []
    for x in lines:  # 같은 문장이 두 번 나오면 하나만
        k = re.sub(r"\s+", "", x["text"])
        if k not in seen:
            seen.add(k)
            uniq.append(x)
    lines = uniq
    l1 = [x for x in lines if x["level"] == 1][:max(1, limit // 2)]
    rest = sorted([x for x in lines if x["level"] != 1], key=lambda x: x["level"])
    keep = (l1 + rest)[:max(limit, len(l1))]
    order = {id(x): i for i, x in enumerate(lines)}
    return sorted(keep, key=lambda x: order[id(x)])


GROUP_MAX_MS = 12_000  # 문장 끝이 안 나와도 이 길이에서 끊는다(받아쓰기가 구두점을 안 찍는 구간)


def group_sentences(segs: list[dict]) -> list[dict]:
    """받아쓰기 조각을 문장 단위로 묶는다(조각마다 번역하면 숫자가 엉뚱한 재료에 붙었다). 문장 끝(.?!)이나 12초에서 끊는다."""
    out: list[dict] = []
    cur: dict | None = None
    for x in segs:
        if cur is None:
            cur = {"startMs": x["startMs"], "endMs": x["endMs"], "text": x["text"].strip()}
        else:
            cur["endMs"] = x["endMs"]
            cur["text"] = f"{cur['text']} {x['text'].strip()}"
        if re.search(r"[.?!。]\s*$", x["text"]) or cur["endMs"] - cur["startMs"] >= GROUP_MAX_MS:
            out.append(cur)
            cur = None
    if cur:
        out.append(cur)
    return out


async def translate_segments(inf, segs: list[dict], language: str | None, title: str | None, gms: GmsClient | None,
                             job_id: int | None) -> list[dict]:
    """대사가 한국어가 아니면 문장 단위로 묶어 한국어로 옮긴다. 번역에 실패하면 원문 그대로(묶지 않은 조각)."""
    if not segs or not language or language == "ko":
        return segs
    groups = group_sentences(segs)
    try:
        ko = (await inf.translate([x["text"] for x in groups], language, title))["texts"]
    except inference.InferenceError:
        return segs
    if len(ko) != len(groups):
        return segs
    out = [{**x, "text": t, "original": x["text"]} for x, t in zip(groups, ko)]
    return await fix_translations(out, title, gms, job_id)


async def fix_translations(out: list[dict], title: str | None, gms: GmsClient | None, job_id: int | None) -> list[dict]:
    """H200 번역 가운데 잘못된 것 같은 묶음만 Gemini로 다시 번역한다. GMS가 없거나 TRANSLATE_FIX=off면 H200 번역 그대로."""
    for x in out:
        x["translatedBy"] = "h200"
    m = tf.mode()
    if not gms or m == "off":
        return out
    idx = list(range(len(out))) if m == "all" else [i for i, x in enumerate(out) if tf.problem(x["original"], x["text"])]
    if not idx:
        return out
    fixed = await tf.fix_with_gemini(gms, title, out, idx, job_id)
    for i, k in fixed.items():
        out[i] = {**out[i], "text": k, "translatedBy": "gemini", "h200Text": out[i]["text"]}
    return out


def build_guide(title: str | None) -> str:
    """추론 서버 /describe에 보내는 지침: 문장 규칙 + 시리즈 등장인물 사전 + 요리 지침(유튜브 해설과 같은 사전 재사용)."""
    extra, _ = prompts.genre_guide(title)
    return STYLE_GUIDE + extra


def mmss_ms(ms: int) -> str:
    """밀리초까지 남기는 MM:SS.s(to_ms가 소수 초를 읽음). 대사 시각용"""
    s = max(0, ms) / 1000
    return f"{int(s // 60):02d}:{s % 60:06.3f}"


def mmss(ms: int) -> str:
    s = max(0, ms) // 1000
    return f"{s // 60:02d}:{s % 60:02d}"


def detect_scenes(video_path: Path, duration_ms: int) -> list[dict]:
    from scenedetect import ContentDetector, detect

    cuts = [(int(a.seconds * 1000), int(b.seconds * 1000)) for a, b in detect(str(video_path), ContentDetector())]
    if not cuts:
        cuts = [(0, duration_ms)]
    return split_scenes(cuts, duration_ms)


def split_scenes(cuts: list[tuple[int, int]], duration_ms: int) -> list[dict]:
    """짧은 장면은 앞 장면에 붙이고, 붙인 뒤에도 긴 장면은 MAX_SCENE_SEC로 나눈다."""
    merged: list[list[int]] = []
    for a, b in cuts:
        if merged and (b - a) < MIN_SCENE_SEC * 1000:
            merged[-1][1] = b
        else:
            merged.append([a, b])
    merged[-1][1] = duration_ms
    out = []
    step = int(MAX_SCENE_SEC * 1000)
    for a, b in merged:
        while b - a > step:
            out.append({"startMs": a, "endMs": a + step})
            a += step
        out.append({"startMs": a, "endMs": b})
    return out


async def analyze_opensource(inf, title: str | None, files: dict, work: Path, duration_ms: int, progress,
                             gms: GmsClient | None, job_id: int | None, db=None) -> tuple[dict, str]:
    """오픈소스 경로: 받아쓰기·장면·화면 글자·해설·요약을 나눠 분석해 Gemini 형식(raw)으로 모은다."""
    playback, wav = files["playback"], files["wav"]

    def scenes_and_shots():
        scenes = detect_scenes(playback, duration_ms)
        return scenes, frames(playback, work, scenes, per_scene=frames_for)

    # 장면 찾기·사진 뽑기는 이 서버 CPU 일이라 H200의 받아쓰기·번역과 동시에 돌린다
    scene_job = asyncio.create_task(asyncio.to_thread(scenes_and_shots))
    try:
        await progress(6)
        t0 = time.monotonic()
        stt = await inf.transcribe(wav)
        await inference.log_remote(db, "STT", str(stt.get("model", "")), t0, job_id=job_id)
        language = stt.get("language")
        await progress(9)
        t0 = time.monotonic()
        segs = await translate_segments(inf, stt["segments"], language, title, gms, job_id)
        if any(x.get("original") for x in segs):
            await inference.log_remote(db, "STT", "translate", t0, job_id=job_id)  # purpose에 TRANSLATE 없음
        scenes, shots = await scene_job
    except BaseException:
        scene_job.cancel()
        raise
    await progress(11)
    flat = [p for group in shots for p in group]
    t0 = time.monotonic()
    texts = (await inf.ocr(flat))["texts"] if flat else []
    await inference.log_remote(db, "DESCRIBE", "paddleocr", t0, job_id=job_id)  # purpose에 OCR 없음
    ocr_by_scene, k = [], 0
    for group in shots:
        words: list[str] = []
        for t in texts[k:k + len(group)]:
            words += [w for w in t if w not in words]
        ocr_by_scene.append(words)
        k += len(group)

    await progress(13)
    foreign = bool(segs) and language not in (None, "ko")
    payload = {"title": title or "", "guide": build_guide(title) + (FOREIGN_GUIDE if foreign else ""),
               "scenes": [{"startMs": s["startMs"], "endMs": s["endMs"],
                           "transcript": " ".join(x["text"] for x in segs if overlaps(x, s)),
                           "ocr": ocr_by_scene[i], "frames": [str(p) for p in shots[i]]} for i, s in enumerate(scenes)]}
    t0 = time.monotonic()
    desc = await inf.describe(payload)
    await inference.log_remote(db, "DESCRIBE", str(desc.get("model", "")), t0, job_id=job_id)
    for sc, sd in zip(desc["scenes"], scenes):
        sc["lines"] = cap_lines([{**ln, "text": finish_sentence(ln["text"])} for ln in sc["lines"] if finish_sentence(ln["text"])],
                                sd["endMs"] - sd["startMs"])
    lines = [ln for sc in desc["scenes"] for ln in sc["lines"]]
    await progress(17)
    t0 = time.monotonic()
    summ = await inf.summarize({"title": title or "", "transcript": " ".join(x["text"] for x in segs),
                                "sceneTitles": [sc["title"] for sc in desc["scenes"]], "lines": [ln["text"] for ln in lines]})
    await inference.log_remote(db, "SUMMARY", str(summ.get("model", "")), t0, job_id=job_id)

    raw = to_raw(segs, language, scenes, desc["scenes"], ocr_by_scene, lines, summ)
    return raw, f"local:{desc.get('model', inf.name)}"


def to_raw(segs: list[dict], language: str | None, scenes: list[dict], desc_scenes: list[dict], ocr_by_scene: list[list[str]],
           lines: list[dict], summ: dict) -> dict:
    """Gemini 형식으로 바꿔 유튜브와 같은 정리(normalize)·저장 코드를 쓴다."""
    return {
        "category": summ.get("category", "기타"),
        "summary_30s": summ["summary"],
        "dialogue": [{"start": mmss_ms(x["startMs"]), "end": mmss_ms(x["endMs"]), "speaker": None, "text": x["text"],
                      "original": x.get("original")} for x in segs],
        "dialogue_language": language if any(x.get("original") for x in segs) else None,
        "scenes": [{"start": mmss(s["startMs"]), "end": mmss(s["endMs"]), "title": d["title"], "people": d.get("people", []),
                    "screen_text": [{"text": w, "text_type": "OTHER", "importance": "중", "same_as_dialogue": False}
                                    for w in ocr_by_scene[i]]} for i, (s, d) in enumerate(zip(scenes, desc_scenes))],
        "lines": [{"at": mmss(ln["atMs"]), "level": ln["level"], "text": ln["text"]} for ln in lines],
    }


# ---------- Gemini 엔진(데모 upload_gemini.py) ----------

LONG_VIDEO_SEC = 180
MODEL_LONG, MODEL_SHORT = "gemini-3.5-flash", "gemini-3.8-flash"
INLINE_MAX_BYTES = 19 * 1024 * 1024  # inline_data 요청 한도 20MB(가정)


async def analyze_gemini(gms: GmsClient, title: str | None, playback: Path, duration_sec: int, job_id: int | None) -> tuple[dict, str]:
    """재생용 MP4를 Gemini에 inline_data로 넣어 유튜브와 같은 누적형 해설 JSON을 받는다(크레딧 사용)."""
    model = MODEL_LONG if duration_sec >= LONG_VIDEO_SEC else MODEL_SHORT
    data = playback.read_bytes()
    if len(data) > INLINE_MAX_BYTES:
        raise WorkerError("UNKNOWN", f"Gemini 파일 입력은 {INLINE_MAX_BYTES // 1024 // 1024}MB까지만 시험했어요", retryable=False)
    prompt, _ = prompts.build_prompt(PROMPT, title)
    cfg = types.GenerateContentConfig(response_mime_type="application/json", response_schema=Narration, temperature=0.2,
                                      thinking_config=types.ThinkingConfig(thinking_budget=0))
    contents = types.Content(parts=[types.Part(inline_data=types.Blob(mime_type="video/mp4", data=data)), types.Part(text=prompt)])
    r = await gms.generate(model, contents, cfg, CallContext("DESCRIBE", job_id=job_id))
    raw = json.loads(r.text)
    Narration.model_validate(raw)
    return raw, f"gemini:{model}"


# ---------- 엔진 고르기(데모 local_pipeline.run) ----------

async def analyze(engine: str, inf, gms: GmsClient | None, has_gms: bool, title: str | None, files: dict, work: Path,
                  duration_ms: int, progress, job_id: int | None, db=None) -> tuple[dict, str, list[str]]:
    """UPLOAD_ENGINE=video(32B 영상 보기)|opensource(장면별)|gemini. 고른 엔진이 실패하면 다른 엔진으로(모두 안 되면 실패).
    반환 (raw, 모델 이름, 실패한 엔진 목록)."""
    from app.pipeline import video
    order = {"gemini": ["gemini", "opensource"], "video": ["video", "opensource", "gemini"]}.get(engine, ["opensource", "gemini"])
    errors: list[str] = []
    for eng in order:
        try:
            if eng == "video":
                raw, model = await video.analyze_video(inf, title, files, work, duration_ms, progress, None, job_id)
            elif eng == "gemini":
                if not (gms and has_gms):
                    errors.append("gemini: GMS 꺼짐")
                    continue
                raw, model = await analyze_gemini(gms, title, files["playback"], duration_ms // 1000, job_id)
            else:
                raw, model = await analyze_opensource(inf, title, files, work, duration_ms, progress, gms if has_gms else None,
                                                      job_id, db)
            if errors:
                model += " (대체)"
            return raw, model, errors
        except (inference.InferenceError, WorkerError) as e:
            errors.append(f"{eng}: {e.code}")
            log.warning("업로드 분석 %s 실패, 다른 엔진으로: %s", eng, e)
        except Exception as e:  # noqa: BLE001 — GMS 오류 등
            errors.append(f"{eng}: {type(e).__name__}")
            log.warning("업로드 분석 %s 실패, 다른 엔진으로: %s", eng, str(e)[:300])
    raise WorkerError("UNKNOWN", "해설을 만들지 못했어요(" + "; ".join(errors) + ")")
