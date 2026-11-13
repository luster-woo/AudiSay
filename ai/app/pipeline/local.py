"""업로드 영상(LOCAL)의 job.prepare: 영상 파일을 직접 나눠 분석해 유튜브와 **같은 full.json**을 만든다.

데모에서 검증한 흐름을 그대로 옮겼다(데모 backend/app/pipeline/upload.py + local_pipeline.py + upload_gemini.py).
바꾼 것은 팀 환경에 맞춘 부분뿐이다: 파일은 S3(원본 받기·재생용 올리기)와 임시 폴더, AI 호출은 비동기(팀 GmsClient·
inference.RemoteInference), 결과는 SQLite 대신 full.json/prepare.json(그 뒤 describe·merge·tts는 유튜브와 같은 코드).

흐름(오픈소스 엔진, 기본)
1. S3 원본(uploads/{videoId}/original.*) → 임시 폴더. ffprobe로 길이·코덱 확인
2. 재생용 MP4(H.264면 재포장, 아니면 변환) → S3 playback/{videoId}.mp4, 받아쓰기용 16kHz wav, 썸네일 → uploads/{videoId}/thumb.jpg
3. 두 갈래를 나란히
   - 화면 쪽: 장면 나누기(PySceneDetect, 이 서버 CPU) → 장면별 대표 사진 → H200 화면 글자(PaddleOCR, 늘 떠 있는 로고는 뺌)
   - 소리 쪽: H200 받아쓰기(faster-whisper, 언어 자동) → 외국어면 번역 / 영상 전체를 3초 간격으로 훑은 사진 + H200 효과음
     → H200 줄거리(32B: 핵심 사건과 인물표)
   받아쓴 말이 없는 영상(애니메이션·몸개그)은 장면을 더 잘게 나누고 사진을 더 촘촘히 뽑아 동작 중심으로 쓰게 한다
4. H200 장면 해설(Qwen3-VL, 사진+대사+글자+줄거리·인물표) / 그동안 H200 32B가 화면 문구(제목·방송 안내·기사 제목·알림)를 고름
   → 개조식 끝 고치기·대사 옮기기와 옷차림만 있는 문장 거르기·문장 수 줄이기·겹친 시각 띄우기·되풀이 빼기 → H200 요약
   → 같은 동작 거르기
5. Gemini 응답과 같은 모양(raw)으로 모아 prepare.normalize → full.json
H200이 실패하면 Gemini 엔진(영상 파일을 Gemini에 넣음, 크레딧)으로, UPLOAD_ENGINE=gemini면 그 반대 순서.
"""
import asyncio
import base64
import json
import logging
import os
import re
import subprocess
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from difflib import SequenceMatcher
from pathlib import Path

from google.genai import types

from app import inference
from app.errors import WorkerError
from app.gms.client import CallContext, GmsClient
from app.pipeline import prompts
from app.pipeline import translate_fix as tf
from app.pipeline.narration_schema import PROMPT, Narration, to_ms

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


def video_end_sec(path: Path) -> float | None:
    """영상 트랙이 끝나는 시각. 소리 트랙이 더 길면 파일 길이(format)보다 짧다(데모 Hanbid: 파일 155.8초, 영상 154.8초)."""
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=duration", "-of", "csv=p=0",
                        str(path)], capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return None


GRAB_WORKERS = 8


def _grab_all(grab, jobs: list) -> None:
    """사진 한 장마다 ffmpeg 한 번(앞부분만 찾아 읽어 빠름)을 여러 개 동시에 돌린다.
    차례로 하면 장당 약 0.12초라 150초 영상의 장면 사진 68장에 8초, 줄거리 사진 50장에 7초 걸렸다(2026-11-04 데모 실측)."""
    with ThreadPoolExecutor(max_workers=GRAB_WORKERS) as pool:
        list(pool.map(grab, jobs))


FRAME_MAX = 8  # 장면 한 번에 보내는 사진 수 한도(H200 vLLM --limit-mm-per-prompt image 8)
FRAME_MODE = os.getenv("FRAME_MODE", "dialogue")  # even: 고르게 | dialogue: 고르게 + 대사가 시작하는 시각
# 대사 있는 영상의 장면 사진 간격. 3초면 문 잠그기처럼 짧은 동작을 놓쳤다(2026-11-13 킹스맨: 2초에서만 0:05 문 동작을 씀,
# 전체 시간은 38~39초로 같음)
FRAME_EVERY_MS = int(os.getenv("FRAME_EVERY_MS", "2000"))


def frame_ms(path: Path) -> int | None:
    """frames()가 붙인 파일 이름(s003_5_2_41250.jpg)에서 사진 시각(ms). 시각이 없는 이름이면 None."""
    tail = Path(path).stem.rsplit("_", 1)[-1]
    return int(tail) if "_" in Path(path).stem and tail.isdigit() else None


def frame_times(paths: list[Path]) -> list[int]:
    """사진 시각 목록. 하나라도 모르면 빈 목록(서버가 예전처럼 장면 시작부터 문장을 붙인다)."""
    ms = [frame_ms(p) for p in paths]
    return [m for m in ms if m is not None] if all(m is not None for m in ms) else []


def frames(playback: Path, work: Path, scenes: list[dict], per_scene=4, extra_ms: list[list[int]] | None = None
           ) -> list[list[Path]]:
    """장면마다 대표 프레임 n장. per_scene은 숫자 또는 (장면 길이 ms → 장 수) 함수.
    영상 트랙이 끝난 뒤 시각은 뽑지 못하므로 끝 0.2초 앞까지로 자르고, 한 장이 실패하면 1초 앞에서 한 번 더 뽑는다.
    그래도 실패한 사진은 건너뛴다(사진 한 장 때문에 작업 전체가 TRANSCODE_FAILED가 되던 것, 2026-11-02 데모 Hanbid).
    사진이 하나도 없는 장면은 앞 장면의 마지막 사진을 쓴다.
    extra_ms: 장면마다 꼭 넣을 시각(대사가 시작하는 때). 대사와 함께 일어나는 짧은 동작(문 잠그기)이 고르게 뽑은 사진 사이에
    빠졌다(2026-11-13 킹스맨). 합쳐 FRAME_MAX장을 넘으면 고르게 뽑는 장 수를 줄이고, 1초 안에 겹치는 시각은 하나만.
    파일 이름 끝에 사진 시각(ms)을 붙여 둔다(frame_ms)."""
    out_dir = work / "frames"
    out_dir.mkdir(parents=True, exist_ok=True)
    end = video_end_sec(playback)
    plan: list[list[tuple[Path, float]]] = []
    for i, s in enumerate(scenes):
        a, b = s["startMs"] / 1000, s["endMs"] / 1000
        n = per_scene(s["endMs"] - s["startMs"]) if callable(per_scene) else per_scene
        extra = sorted(set(m / 1000 for m in (extra_ms[i] if extra_ms else []) if a <= m / 1000 < b))
        n = max(2, min(n, FRAME_MAX - len(extra))) if extra else n
        times = [a + (b - a) * (k + 0.5) / n for k in range(n)]
        for t in extra:
            if all(abs(t - u) >= 1.0 for u in times):
                times.append(t)
        times = sorted(times)[:FRAME_MAX]
        shots = []
        for k, t in enumerate(times):
            if end:
                t = min(t, max(0.0, end - 0.2))
            shots.append((out_dir / f"s{i:03d}_{n}_{k}_{int(t * 1000)}.jpg", t))
        plan.append(shots)

    def grab(job: tuple[Path, float]) -> None:
        p, t = job
        for tt in (t, max(0.0, t - 1.0)):
            if p.exists():
                break
            try:
                _ff("-ss", f"{tt:.2f}", "-i", str(playback), "-frames:v", "1", "-vf", "scale=768:-2", "-q:v", "4", str(p))
            except WorkerError:
                p.unlink(missing_ok=True)

    _grab_all(grab, [j for shots in plan for j in shots])
    result: list[list[Path]] = []
    for shots in plan:
        paths = [p for p, _ in shots if p.exists()]
        if not paths and result and result[-1]:
            paths = [result[-1][-1]]
        if not paths:
            raise WorkerError("TRANSCODE_FAILED", "영상에서 장면 사진을 뽑지 못했어요")
        result.append(paths)
    return result


def timeline_frames(playback: Path, work: Path, duration_ms: int, every_ms: int = 3000, limit: int = 72) -> list[tuple[int, Path]]:
    """영상 전체를 고르게 훑는 사진(줄거리 보기, H200 /story). 3초 간격, 많아야 72장(격자 8장 × 9칸).
    영상이 길면 간격을 넓힌다. 영상 트랙이 끝난 뒤 시각은 넣지 않고, 실패한 시각은 건너뛴다."""
    out_dir = work / "timeline"
    out_dir.mkdir(parents=True, exist_ok=True)
    end = video_end_sec(playback) or duration_ms / 1000
    step = max(every_ms, -(-duration_ms // limit))
    plan = [(at, out_dir / f"t{at}.jpg") for at in range(step // 2, int(end * 1000), step)]

    def grab(job: tuple[int, Path]) -> None:
        at, p = job
        try:
            _ff("-ss", f"{at / 1000:.2f}", "-i", str(playback), "-frames:v", "1", "-vf", "scale=384:-2", "-q:v", "5", str(p))
        except WorkerError:
            p.unlink(missing_ok=True)

    _grab_all(grab, plan)
    return [(at, p) for at, p in plan if p.exists()]


# ---------- 3·4. 오픈소스 분석(데모 local_pipeline.py) ----------

MIN_SCENE_SEC = 4.0  # 2초였을 때 2분 요리 영상이 25장면(평균 5초)으로 잘게 나뉨
# 장면 길이·사진 간격·문장 수·대사 요약 거르기·이름 근거의 기본값은 데모에서 Gemini 정답지 5편(예능·애니·요리·시트콤·드라마)과
# 견줘 정했다(2026-11-10): 30초·6초·6초에 거르기를 끈 값은 평균 종합 0.41, 지금 값은 0.44(2회 0.443·0.446)
MAX_SCENE_SEC = 15.0  # 장면이 길면 사건을 놓친다(30초일 때 정답지 사건을 덜 담았다)
SILENT_MAX_SCENE_SEC = 12.0  # 대사 없는 영상은 더 잘게. 19~22초 장면에서 동작을 놓치고 해설이 18초씩 비었다(2026-11-02 데모 Caminandes)

# 추론 서버에 함께 보내는 해설 지침. 첫 실분석(2026-10-28)에서 "표시됨"처럼 개조식으로 끝나는 문장이 섞여 넣었다
STYLE_GUIDE = ("누적형 해설(level 1~3). 화면에 보이는 것만 쓰고 대사를 반복하지 않습니다. "
               "모든 문장은 \"~합니다\", \"~있습니다\", \"~입니다\"처럼 현재형으로 끝나는 완결된 문장으로 씁니다. "
               "\"표시됨\", \"구성됨\", \"있음\"처럼 명사형으로 끝내지 않습니다. 한 문장 40자 안팎. "
               "문장 수는 장면 길이에 맞춥니다: 6초에 1문장 정도, level 1은 장면마다 1문장. "
               "숫자·표·그래프의 값은 화면 글자에 적힌 대로 정확히 읽습니다. "
               "'선수1', '인물A'처럼 번호·기호를 붙인 임시 이름은 쓰지 않습니다(이름을 모르면 '한 선수', '안경 쓴 남자'처럼 겉모습으로). "
               "확실히 보이지 않는 물건·특징은 쓰지 않고, 같은 물건은 영상 내내 같은 이름으로 부릅니다.")

# 대사 없는 영상(애니메이션·몸개그·요리 무음). 사진 몇 장을 따로 보고 "앉아 있습니다"만 쓰던 것(2026-11-02 데모 Caminandes)
ACTION_GUIDE = (" 이 영상에는 대사가 없습니다. 사진은 장면 안에서 시간 순서대로입니다. 사진 사이에 무엇이 바뀌었는지, "
                "누가 무엇을 하고 그 결과 어떻게 되는지(동작·사건)를 중심으로 씁니다. '앉아 있습니다', '바라봅니다'처럼 "
                "멈춘 모습만 쓰지 않습니다. level 1은 그 장면의 핵심 사건입니다.")
# 말소리 없이 자막이 대사 역할을 하는 영상(예능 클립). 자막을 안 읽어 장면마다 "셀카를 찍고 있습니다"만 반복했다(2026-11-02 데모)
CAPTION_GUIDE = (" 이 영상은 말소리 대신 화면 자막이 대사 역할을 합니다. 화면 글자 가운데 자막(누가 한 말·편집자 설명)은 해설에 "
                 "담아 장면의 재미가 전해지게 합니다(예: 자막으로 '하지 마!'라고 외칩니다). 자막에 나온 이름은 인물 이름의 근거로 씁니다.")
CAPTIONS_PER_MIN = 6  # 늘 떠 있는 글자를 뺀 뒤 1분에 이만큼 넘게 글자가 나오면 자막 영상으로 본다
# 장면을 따로 써서 같은 사람을 장면마다 다른 이름·옷으로 불렀고(한 사람이 줄무늬·검은 코트·베이지·검은 지퍼), 문장 다수가
# "○○ 스웨터 남자가 말하고 있습니다"나 대사 옮기기였다(2026-11-09 데모 예능). 영상 전체를 한 번 보고(줄거리 단계) 인물표를
# 만들어 모든 장면에 넘기고 같은 기준으로 쓰게 한다. 앞은 줄거리 단계, 뒤는 장면 해설에 붙이는 지침
SCENE_CAST_GUIDE = (" 인물 이름은 영상 제목·화면 자막·대사에 그대로 나올 때만 쓰고, 확실하지 않으면 name에 겉모습 호칭"
                    "(예: '회색 니트 안경 남성')을 씁니다. what에는 그 사람을 다른 사람과 구별할 겉모습(옷 색과 종류, 안경, 머리)을 씁니다.")
SCENE_FIX_GUIDE = (" 인물은 '정해 둔 인물·물건 이름'의 호칭과 생김새를 그대로 씁니다. 목록에 없는 이름을 붙이지 않고 목록과 다른 옷을 쓰지 않습니다."
                   " 옷차림만 말하거나 '말하고 있습니다'만 있는 문장은 쓰지 않습니다. 대사로 들리는 내용은 옮기지 않습니다."
                   " 대사로는 알 수 없는 것, 곧 누가 무엇을 하는지(동작), 표정·몸짓·리액션, 화면 자막의 핵심 문구, 장소와 상황의 변화를 씁니다.")
# all: 제목·화면 글자·대사에 나온 이름을 쓴다. screen: 대사에서만 들린 이름은 쓰지 않는다(들려도 화면의 누가 그 사람인지는 모른다)
NAME_SOURCE = os.getenv("NAME_SOURCE", "screen")
# on이면 말로 한 내용을 요약한 문장("AI가 볼링을 추천합니다")을 쓰지 않게 하고(SPEECH_GUIDE) 남은 것도 뺀다(drop_speech_acts)
SPEECH_FILTER = os.getenv("SPEECH_FILTER", "on") == "on"
SPEECH_GUIDE = (" 인물이 말로 설명·제안·질문·주장하는 내용은 대사로 들리므로 해설에 쓰지 않습니다."
                " level 1도 말한 내용의 요약이 아니라 화면에서 보이는 행동과 그 결과(일어선다, 계산대로 간다, 휴대폰을 내민다)를 씁니다.")
MIN_LINE_GAP_MS = 2000  # 한 장면 안 문장 사이 최소 간격. 같은 시각에 두 문장이 겹쳤다(2026-11-02 데모 Caminandes 92초)

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
    """대사 묶음이 장면과 겹치는가. 문장으로 묶은 대사(최대 12초)가 앞 장면에서 시작해도 이 장면에 넘겨 준다.
    다만 끝자락만 걸친 대사는 넘기지 않는다(겹친 길이가 대사 길이의 절반과 2초 가운데 짧은 쪽보다 짧으면): 해리포터 81~91.6초
    "메리 크리스마스" 대사가 91~101초 장면에 0.6초 걸쳐 들어가, 올빼미·잠에서 깨는 장면을 "크리스마스 인사를 나누는
    소년들"로 썼다(2026-11-12)."""
    shared = min(seg["endMs"], scene["endMs"]) - max(seg["startMs"], scene["startMs"])
    return shared > 0 and shared >= min(2000, (seg["endMs"] - seg["startMs"]) / 2)


def frames_for(scene_ms: int) -> int:
    """장면 길이에 맞춘 대표 사진 수: FRAME_EVERY_MS(기본 3초)에 1장, 4~8장."""
    return max(4, min(8, round(scene_ms / FRAME_EVERY_MS)))


def frames_for_silent(scene_ms: int) -> int:
    """대사 없는 영상: 3초에 1장(4~8장). 동작은 사진 사이에서 일어나므로 더 촘촘히 본다."""
    return max(4, min(8, round(scene_ms / 3000)))


SEC_PER_LINE = 4.0  # 장면 길이 몇 초에 문장 하나(모든 상세도 합). 해설 읽기 약 3~4초
# 상세도별 누적 한도: 상세도 1은 10초에 하나, 상세도 2(1+2)는 6초에 하나, 상세도 3(1+2+3)은 SEC_PER_LINE초에 하나
SEC_PER_LINE_L1 = 10.0
SEC_PER_LINE_L2 = 6.0


def cap_lines(lines: list[dict], scene_ms: int) -> list[dict]:
    """장면 길이에 비해 문장이 너무 많으면 줄인다. 모델이 짧은 장면에도 문장을 3~5개씩 써서 2분 영상이 115문장이 된
    문제(2026-10-29). 상세도마다 누적 한도를 따로 둔다: 전체 한도 하나로 낮은 level부터 채우면 짧은 장면에서 level 2가
    자리를 다 써서 level 3이 늘 잘렸고, 상세도 2와 3이 똑같이 들렸다(2026-11-12 크레페 level 3 문장 0개)."""
    sec = scene_ms / 1000
    b1 = max(1, int(sec // SEC_PER_LINE_L1))
    b2 = max(b1, round(sec / SEC_PER_LINE_L2))
    b3 = max(b2, round(sec / SEC_PER_LINE))
    seen: set[str] = set()
    uniq = []
    for x in lines:  # 같은 문장이 두 번 나오면 하나만
        k = re.sub(r"\s+", "", x["text"])
        if k not in seen:
            seen.add(k)
            uniq.append(x)
    lines = uniq
    keep = [x for x in lines if x["level"] == 1][:b1]
    keep += [x for x in lines if x["level"] == 2][:max(0, b2 - len(keep))]
    keep += [x for x in lines if x["level"] >= 3][:max(0, b3 - len(keep))]
    order = {id(x): i for i, x in enumerate(lines)}
    return sorted(keep, key=lambda x: order[id(x)])


def _norm(text: str) -> str:
    return re.sub(r"[\W_]+", "", text).lower()


def clean_ocr(ocr_by_scene: list[list[str]]) -> list[list[str]]:
    """늘 떠 있는 로고·워터마크(장면 절반 이상, 3장면 이상에 나오는 글자)와 한 글자짜리를 뺀다. OCR이 조금씩 다르게 읽은
    같은 로고('코보티비'·'코보E비'·'코보O티비')는 비슷하면(75%) 같은 글자로 본다. 로고가 장면마다 반복됐다(2026-11-02 데모)."""
    reps: list[str] = []

    def group(k: str) -> int:
        for i, r in enumerate(reps):
            if SequenceMatcher(None, k, r).ratio() >= 0.75:
                return i
        reps.append(k)
        return len(reps) - 1

    ids = [[group(_norm(w)) for w in words] for words in ocr_by_scene]
    n = len(ocr_by_scene)
    seen = Counter(g for row in ids for g in set(row))
    persistent = {g for g, c in seen.items() if n >= 3 and c >= max(3, n * 0.5)}
    return [[w for w, g in zip(words, row) if g not in persistent and len(_norm(w)) >= 2]
            for words, row in zip(ocr_by_scene, ids)]


def looks_like_json(text: str) -> bool:
    """추론 서버 답이 끊겨 JSON 조각이 문장으로 들어온 것('{"title": ...'). 음성으로 읽히면 안 된다."""
    return bool(re.search(r'[{}\[\]]|"\w+"\s*:', text))


def spread_lines(lines: list[dict], scene: dict) -> list[dict]:
    """한 장면 안 문장이 MIN_LINE_GAP_MS보다 붙어 있으면 뒤로 민다. 장면 끝을 넘는 level 2·3 문장은 뺀다."""
    out: list[dict] = []
    last = None
    edge = max(scene["startMs"], scene["endMs"] - 300)
    for ln in sorted(lines, key=lambda x: x["atMs"]):
        at = ln["atMs"] if last is None else max(ln["atMs"], last + MIN_LINE_GAP_MS)
        # 장면 끝에 붙이면 같은 시각에 겹친다(2026-11-12 크레페 마지막 300.4초에 4문장). level 1이라도 앞 문장이 이미
        # 끝에 붙어 있으면 뺀다
        if at >= edge and out and (ln["level"] > 1 or last >= edge - MIN_LINE_GAP_MS):
            continue
        out.append({**ln, "atMs": min(at, max(scene["startMs"], scene["endMs"] - 300))})
        last = out[-1]["atMs"]
    return out


NEAR_REPEAT_MS = 30_000  # 이 시간 안의 비슷한 문장은 더 느슨하게(NEAR_RATIO) 같은 말로 본다
NEAR_RATIO = 0.7
HAN_CHAR = re.compile("[一-鿿]")  # 해설에 섞인 한자("R 자样的 문양", 2026-11-12 해리포터)

# 상세도별 평균 간격(영상 전체 시간 순서). 유튜브(Gemini) 해설은 평균 상세도 1이 약 19초, 상세도 2(1+2)가 약 9초에
# 문장 하나인데, 오픈소스는 장면마다 level 1을 하나씩 써서 크레페가 11.6초·4.7초로 두 배였다(2026-11-12 실측).
# 최소 간격(6초)으로 막았더니 장면 안 문장 간격(4~5초)에 걸려 level 2가 거의 다 level 3으로 내려가 상세도 2가 21.5초에
# 하나가 됐다(같은 날 크레페 재생성) → 평균을 맞추는 토큰 방식으로
LEVEL_AVG_MS = {1: 18_000, 2: 9_000}
LEVEL_BURST = 1.5  # 조용한 구간 뒤에 몰아 쓸 수 있는 문장 수
MIN_GAP_MS = 3_000  # 모든 문장 사이 최소 간격. 이보다 가까우면 덜 중요한(모델이 준 level이 높은) 문장을 뺀다


def thin_levels(desc_scenes: list[dict]) -> None:
    """영상 전체를 시간 순서로 보며 상세도 1·2의 평균 밀도를 유튜브 수준으로 맞춘다. 상세도 n마다 시간이 지나면 쌓이는
    몫(토큰)이 있고, 몫이 없으면 그 문장을 한 단계 높은 상세도로 낮춘다(내용은 상세도 3에 남는다).
    모델이 level 1로 쓴 핵심 사건은 level 2까지만 낮춰 기본 상세도(2)에서 늘 들린다. 3초 안에 붙은 두 문장은 덜 중요한
    쪽을 뺀다: 장면 첫 문장(level 1)이 앞 장면 끝 문장과 붙으면 뒤를 빼서 해리포터 망토 꺼내기·투명해지기가 빠졌다
    (2026-11-12)."""
    tokens = {1: 1.0, 2: 1.0}
    prev = None
    heard: list[tuple[list, dict]] = []  # 남긴 문장(그 장면의 kept 목록, 문장)
    for sc in desc_scenes:
        kept: list[dict] = []
        for ln in sorted(sc["lines"], key=lambda x: x["atMs"]):
            at, orig = ln["atMs"], ln["level"]
            if prev is not None:
                for n in tokens:
                    tokens[n] = min(LEVEL_BURST, tokens[n] + (at - prev) / LEVEL_AVG_MS[n])
            prev = at
            if heard and at - heard[-1][1]["atMs"] < MIN_GAP_MS:
                box, old = heard[-1]
                if old["_orig"] <= orig:
                    continue  # 앞 문장이 같거나 더 중요하다
                box.remove(old)  # 이 문장이 더 중요하다: 앞 문장을 빼고 그 몫을 돌려준다
                heard.pop()
                for n in tokens:
                    if old["level"] <= n:
                        tokens[n] += 1
            lv = orig
            if lv == 1 and tokens[1] < 1:
                lv = 2
            if lv == 2 and tokens[2] < (1 if orig == 2 else -1):  # 핵심 사건은 몫이 크게 모자랄 때만
                lv = 3
            for n in tokens:
                if lv <= n:
                    tokens[n] -= 1
            x = {**ln, "level": lv, "_orig": orig}
            kept.append(x)
            heard.append((kept, x))
        sc["lines"] = kept
    for sc in desc_scenes:
        for x in sc["lines"]:
            if x.pop("_orig", None) == 1:
                x["key"] = True  # 모델이 level 1로 쓴 핵심 사건(같은 동작 되풀이 거르기에서 지키려고)


def drop_repeats(desc_scenes: list[dict], ratio: float = 0.85) -> None:
    """앞 장면에서 이미 한 말과 거의 같은 문장은 뺀다. 장면을 따로 써서 한 사람이 말하는 영상에서 "안경 쓴 남자가
    나무 테이블에 앉아 있습니다"가 30초마다 되풀이됐다(2026-11-02 데모). 다 겹치면 그 장면은 해설 없이 둔다
    (첫 문장을 남기던 때 같은 문장이 9장면에 남았다). 30초 안에서는 조금 덜 닮아도 뺀다: 크레페 영상에서 "크레페를
    뒤집습니다"가 말만 바꿔 12초 동안 네 번 나왔다(2026-11-12)."""
    said: list[tuple[str, int]] = []
    for sc in desc_scenes:
        kept = []
        for ln in sc["lines"]:
            k, at = _norm(ln["text"]), ln.get("atMs", 0)
            if any(SequenceMatcher(None, k, s).ratio() >= (NEAR_RATIO if abs(at - t) <= NEAR_REPEAT_MS else ratio)
                   for s, t in said):
                continue
            kept.append(ln)
            said.append((k, at))
        sc["lines"] = kept


MERGE_TITLE_RATIO = 0.8  # 이웃 장면 제목이 이만큼 닮으면 한 장면(목차 하나)으로 합친다
CHAPTER_MIN_MS = 20_000  # 목차 하나의 최소 길이(유튜브 해설 목차 중앙값 약 23초)


def merge_similar_scenes(scenes: list[dict], desc_scenes: list[dict], ocr_by_scene: list[list[str]]
                         ) -> tuple[list[dict], list[dict], list[list[str]]]:
    """이웃 장면을 목차 하나로 합친다: 제목이 같거나 거의 같을 때, 또는 앞 묶음이 CHAPTER_MIN_MS보다 짧을 때.
    목차가 장면마다 하나라 크레페 5분 영상이 41개 목차가 되고 "반죽을 체에 거릅니다"가 다섯 번 이어졌으며, 비슷한 제목을
    합친 뒤에도 31개(9.7초에 하나)로 유튜브(약 20초에 하나)의 두 배였다(2026-11-12). 합친 장면은 가장 긴 장면의 제목을
    쓰고 문장·인물·화면 글자를 모은다."""
    out_s: list[dict] = []
    out_d: list[dict] = []
    out_o: list[list[str]] = []
    best: list[int] = []  # 묶음마다 제목을 가져온 장면의 길이
    for s, d, o in zip(scenes, desc_scenes, ocr_by_scene):
        ms = s["endMs"] - s["startMs"]
        similar = out_d and SequenceMatcher(None, _norm(out_d[-1]["title"]), _norm(d["title"])).ratio() >= MERGE_TITLE_RATIO
        short = out_s and out_s[-1]["endMs"] - out_s[-1]["startMs"] < CHAPTER_MIN_MS
        if similar or short:
            out_s[-1] = {**out_s[-1], "endMs": s["endMs"]}
            prev = out_d[-1]
            seen = {p.get("appearance") for p in prev.get("people", [])}
            title = prev["title"]
            if not similar and ms > best[-1]:
                title, best[-1] = d["title"], ms
            out_d[-1] = {**prev, "title": title, "lines": prev["lines"] + d["lines"],
                         "people": prev.get("people", []) + [p for p in d.get("people", []) if p.get("appearance") not in seen]}
            out_o[-1] = out_o[-1] + [w for w in o if w not in out_o[-1]]
            continue
        out_s.append(dict(s))
        out_d.append(dict(d))
        out_o.append(list(o))
        best.append(ms)
    return out_s, out_d, out_o


IDLE_LINE = re.compile(r"(입고 있|착용하고 있|말하고 있|말합니다|말한다|말하는 자세를 취하고 있)(습니다|다)?\.?$")
OTHER_ACTION = re.compile(r"(?<!입)(?<!착용하)(고|며|면서)\s(?!있)")  # "들여다보며 말합니다"처럼 다른 동작이 함께 있는지
SPEECH_ACT = re.compile(r"(설명|제안|질문|요청|논의|언급|주장|우려|의심|추천|대답|대화|이야기|약속|부탁|소개|강조|말|묻)"
                        r"(합니다|한다|하고 있습니다|하고 있다|습니다|는다|하며 [^.]*|을 나눕니다|를 나눕니다)\.?$")
VISUAL_CUE = re.compile(r"표정|손|고개|눈을|웃|일어|다가|가리키|들고|내밀|바라보|몸을|자리|걸어|뛰|서서|박수|껴안|안아|화면|자막")


def drop_idle(lines: list[dict]) -> list[dict]:
    """옷차림만, '말하고 있다'만 전하는 문장을 뺀다(2026-11-09 데모 예능: "주우재는 줄무늬 티셔츠를 입고 있습니다",
    "검은 후드티 청년 남성이 말한다"). 대사로 말하는 건 이미 들리고 옷은 인물표로 한 번 정했다.
    다른 동작을 함께 쓴 문장("휴대폰을 들여다보며 말합니다")은 남긴다."""
    return [x for x in lines if not (IDLE_LINE.search(x["text"]) and not OTHER_ACTION.search(x["text"]))]


def drop_speech_acts(lines: list[dict]) -> list[dict]:
    """말로 한 내용을 요약한 문장을 뺀다(2026-11-09 데모 예능·시트콤: "AI가 볼링을 추천합니다", "남성이 …을 우려합니다").
    대사로 이미 들린다. 표정·몸짓이 함께 있는 문장은 남긴다."""
    return [x for x in lines if not (SPEECH_ACT.search(x["text"]) and not VISUAL_CUE.search(x["text"]))]


def drop_early(lines: list[dict], segs: list[dict]) -> list[dict]:
    """문장 수 한도(cap_lines)보다 먼저 거른다. 한도가 대사를 옮긴 level 1과 옷차림 문장을 남기고 표정·몸짓 문장을 버린 뒤에
    거르기가 남긴 것마저 빼서, 시트콤 139문장이 한도에서 46문장, 거르기에서 17문장이 됐다(2026-11-10 데모)."""
    from app.pipeline.video import drop_said  # video가 local을 불러와서 여기서 부른다
    out = drop_idle(drop_said([{**x, "at": mmss(x["atMs"])} for x in lines], segs))
    if SPEECH_FILTER:
        out = drop_speech_acts(out)
    return [{k: v for k, v in x.items() if k != "at"} for x in out]


SCREEN_PICK_PROMPT = """영상 제목: {title}
이 사진은 영상의 한 순간입니다. 사진에서 읽은 글자 목록이 아래에 있습니다(글자 인식이라 오타가 있을 수 있습니다).
번호마다 사진에서 그 글자를 찾아 종류(kind)를 하나씩 붙이고, 사진에 보이는 대로 바로잡은 글자(text)를 적으세요. 모든 번호에 붙입니다.
title: 영상 위에 크게 얹은 제목·소제목·홍보 문구
notice: 방송·공개 날짜 안내
news: 화면에 크게 보이는 기사 제목
message: 사진 속 휴대폰·컴퓨터 화면에 뜬 알림·메시지의 내용
none: 그 밖의 모든 것(누가 한 말이나 상황을 적은 자막, 예능 프로그램의 설명 자막, 로고·프로그램 이름·채널 이름, 메뉴·분류,
 간판·상표, 기기 표시, 작은 글자, 뜻을 알 수 없게 깨진 글자)

{listing}"""
SCREEN_PICK_SCHEMA = {"type": "object", "required": ["items"], "properties": {"items": {"type": "array", "items": {
    "type": "object", "required": ["no", "kind", "text"],
    "properties": {"no": {"type": "integer"}, "text": {"type": "string", "maxLength": 60},
                   "kind": {"type": "string", "enum": ["title", "notice", "news", "message", "none"]}}}}}}
SCREEN_LINES = os.getenv("SCREEN_LINES", "on") == "on"  # 화면 문구(제목·방송 안내·기사 제목·알림)를 골라 해설에 넣는다
SCREEN_PICK_FRAMES = 24  # 32B에 보여 주는 사진 수(사진 한 장에 호출 하나, 8장씩 동시에)
SCREEN_PICK_WORDS = 8  # 사진 한 장에서 묻는 글자 수
SCREEN_LINE_SEC = 20  # 영상 이 길이에 화면 문구 문장 하나까지
SCREEN_LOGO_FRAMES = 3  # 이만큼 여러 사진에서 뽑힌 같은 글자는 늘 떠 있는 로고로 본다
SCREEN_BUSY_SEC = 3  # 새 글자가 이보다 자주 뜨는 영상(예능 자막)은 화면 문구를 넣지 않는다. 예능 1.5초·드라마 예고편 8초에 하나였다


def _spoken(word: str, near: str) -> float:
    """화면 글자가 근처 대사에 들어 있는 정도(0~1). 두 글자 넘게 이어서 겹친 것만 센다
    (한 글자씩 흩어져 겹친 것도 세면 '거짓과 기억' 같은 짧은 제목이 대사 자막으로 걸러졌다)."""
    a, b = _norm(word), _norm(near)
    if not a or not b:
        return 0.0
    return sum(m.size for m in SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks() if m.size >= 2) / len(a)


def _same_text(a: str, b: str) -> bool:
    return a in b or b in a or SequenceMatcher(None, a, b).ratio() >= 0.75


def screen_candidates(scenes: list[dict], shots: list[list[Path]], texts: list[list[str]], kept: list[list[str]],
                      segs: list[dict]) -> list[dict]:
    """화면 글자 가운데 대사 자막이 아닌 한글 글자와 그 글자가 처음 보인 사진·시각. 장면 해설은 화면 글자를 넘겨줘도
    문장으로 쓰지 않아(2026-11-09 데모 드라마 예고편: '거짓과 기억'·첫 방송 안내를 하나도 안 씀) 코드가 골라 넣으려고 추린다.
    texts는 사진마다 읽은 글자, kept는 장면마다 로고를 뺀 글자(clean_ocr). 외국어 글자는 음성으로 읽기 어려워 넣지 않는다."""
    out, seen, k = [], [], 0
    for sc, group, ok in zip(scenes, shots, kept):
        near = " ".join(f"{x['text']} {x.get('original') or ''}" for x in segs
                        if x["startMs"] < sc["endMs"] + 3000 and x["endMs"] > sc["startMs"] - 3000)
        n = len(group)
        for j, words in enumerate(texts[k:k + n]):
            at = sc["startMs"] + (sc["endMs"] - sc["startMs"]) * (2 * j + 1) // (2 * n)  # frames가 뽑는 시각
            for w in words:
                key = _norm(w)
                if w not in ok or not re.search(r"[가-힣]{2}", w) or _spoken(w, near) >= 0.6:
                    continue
                if any(SequenceMatcher(None, key, x).ratio() >= 0.75 for x in seen):  # 조금 다르게 읽은 같은 글자
                    continue
                seen.append(key)
                out.append({"atMs": at, "text": w, "frame": group[j]})
        k += n
    return out


async def pick_screen_lines(inf, title: str | None, cands: list[dict], duration_ms: int) -> list[dict]:
    """32B가 사진을 보고 읽어 줄 글자(제목·안내·기사 제목·알림)만 고르고, 문장은 코드가 정해진 틀로 만든다.
    글자만 주고 고르게 하면 하나도 안 고르거나 메뉴('경제')를 기사 제목으로 골랐다(2026-11-10 데모). 모델이 바로잡은 글자는
    읽은 글자와 비슷할 때만 쓴다('나이어' → '라이어'). 종류를 틀리게 붙이기도 해서 문장 틀은 하나만 쓴다."""
    if len(cands) * SCREEN_BUSY_SEC * 1000 > duration_ms:  # 예능 자막은 '(우와)' 같은 것까지 제목으로 골랐다
        return []
    by_frame: dict[str, list[dict]] = {}
    for c in cands:
        by_frame.setdefault(str(c["frame"]), []).append(c)
    groups = [cs[:SCREEN_PICK_WORDS] for cs in list(by_frame.values())[:SCREEN_PICK_FRAMES]]
    gate = asyncio.Semaphore(8)

    async def ask(cs: list[dict]) -> list[tuple[str, str]]:
        """(문장에 쓸 글자, 같은 글자인지 견줄 때 쓰는 글자). 뒤쪽은 모델이 바로잡은 글자라 로고를 여러 가지로 잘못 읽어도 하나로 모인다."""
        listing = "\n".join(f"{i + 1}. {c['text']}" for i, c in enumerate(cs))
        try:
            image = base64.b64encode(Path(cs[0]["frame"]).read_bytes()).decode()
            async with gate:
                r = await inf.generate_json(SCREEN_PICK_PROMPT.format(title=title or "", listing=listing), SCREEN_PICK_SCHEMA,
                                            max_tokens=600, images=[image])
            items = r["result"]["items"]
        except (inference.InferenceError, KeyError, TypeError, OSError):
            return []
        out = []
        for x in items:
            no = x.get("no") if isinstance(x, dict) else None
            if not isinstance(no, int) or not 1 <= no <= len(cs) or x.get("kind") not in ("title", "notice", "news", "message"):
                continue
            read, fixed = cs[no - 1]["text"], str(x.get("text") or "").strip()
            text = fixed if fixed and SequenceMatcher(None, _norm(fixed), _norm(read)).ratio() >= 0.6 else read
            if re.search(r"[가-힣]{2}", text):
                out.append((text.replace("'", "").strip(), _norm(fixed) or _norm(text)))
        return out

    answers = await asyncio.gather(*(ask(cs) for cs in groups))
    count: list[list] = []  # [글자, 그 글자가 뽑힌 사진 수]
    for picked in answers:
        for label in {label for _, label in picked}:
            hit = next((c for c in count if _same_text(label, c[0])), None)
            if hit:
                hit[1] += 1
            else:
                count.append([label, 1])
    logos = [c[0] for c in count if c[1] >= SCREEN_LOGO_FRAMES]
    notes, said = [], []
    for cs, picked in zip(groups, answers):
        fresh = []
        for text, label in picked:
            if any(_same_text(label, x) for x in logos + said) or any(_same_text(_norm(text), x) for x in said):
                continue
            said += [label, _norm(text)]
            fresh.append(text)
        if fresh:
            quotes = fresh[:2]
            notes.append({"atMs": cs[0]["atMs"], "level": 1, "quotes": quotes,
                          "text": "화면에 " + ", ".join(f"'{q}'" for q in quotes) + " 문구가 뜹니다."})
    return notes[:max(3, duration_ms // (SCREEN_LINE_SEC * 1000))]


DESCRIBE_CHUNK = 8  # 추론 서버가 /describe 한 번에서 동시에 쓰는 장면 수와 같게
DESCRIBE_SPLIT = int(os.getenv("DESCRIBE_SPLIT", "3"))  # 장면 해설을 이만큼 동시에 보낸다. 1이면 한 번에


async def describe_scenes(inf, payload: dict) -> dict:
    """장면 해설. 장면을 8개씩 묶어 /describe를 DESCRIBE_SPLIT개까지 동시에 부른다. 장면 프롬프트는 앞뒤 장면을 보지 않아
    나눠도 같고 '장면 3/8' 번호만 묶음 안 번호가 된다. 데모 5편에서 걸린 시간은 그대로(평균 91초)였고 종합 점수는
    한 번에 보낼 때 0.42·0.48, 나눠 보낼 때 0.50·0.49였다(2026-11-10)."""
    scenes = payload["scenes"]
    if DESCRIBE_SPLIT < 2 or len(scenes) <= DESCRIBE_CHUNK:
        return await inf.describe(payload)
    gate = asyncio.Semaphore(DESCRIBE_SPLIT)

    async def one(chunk: list[dict]) -> dict:
        async with gate:
            return await inf.describe({**payload, "scenes": chunk})

    outs = await asyncio.gather(*(one(scenes[k:k + DESCRIBE_CHUNK]) for k in range(0, len(scenes), DESCRIBE_CHUNK)))
    merged = [sc for o in outs for sc in o["scenes"]]
    for i, sc in enumerate(merged):  # 제목을 못 받은 장면에 서버가 붙이는 "n번째 장면"은 묶음 안 번호라 전체 번호로 고친다
        if re.fullmatch(r"\d+번째 장면", sc.get("title") or ""):
            sc["title"] = f"{i + 1}번째 장면"
    models = list(dict.fromkeys(o["model"] for o in outs if o.get("model")))
    return {**outs[0], "scenes": merged, **({"model": "+".join(models)} if models else {})}


GROUP_MAX_MS = 12_000  # 문장 끝이 안 나와도 이 길이에서 끊는다(받아쓰기가 구두점을 안 찍는 구간)
GROUP_GAP_MS = 3_000  # 조각 사이가 이만큼 비면 다른 문장으로 본다


def group_sentences(segs: list[dict]) -> list[dict]:
    """받아쓰기 조각을 문장 단위로 묶는다(조각마다 번역하면 숫자가 엉뚱한 재료에 붙었다). 문장 끝(.?!)이나 12초에서 끊고,
    조각 사이가 GROUP_GAP_MS 이상 비면 묶지 않는다: 해리포터 91초 "happy"와 108초 "christmas harry…"를 한 문장(91~117초)으로
    묶어 그 사이 올빼미 장면에 대사가 붙었다(2026-11-12)."""
    out: list[dict] = []
    cur: dict | None = None
    for x in segs:
        if cur is not None and x["startMs"] - cur["endMs"] >= GROUP_GAP_MS:
            out.append(cur)
            cur = None
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


def ground_names(names: list[dict], title: str | None, ocr_by_scene: list[list[str]], segs: list[dict]) -> list[dict]:
    """줄거리 단계가 정한 이름 가운데 근거(제목·화면 글자·대사)가 없는 것은 겉모습 호칭(what)으로 바꾼다.
    32B가 제목에 있는 이름을 아무에게나 붙이거나 없는 이름을 지어냈다(2026-11-09 데모)."""
    heard = [] if NAME_SOURCE == "screen" else [x["text"] for x in segs]
    seen = " ".join([title or ""] + [w for ws in ocr_by_scene for w in ws] + heard)
    return [n if n["name"] in seen else {**n, "name": n.get("what") or n["name"], "what": ""} for n in names]


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
    return split_long([{"startMs": a, "endMs": b} for a, b in merged], MAX_SCENE_SEC)


def split_long(scenes: list[dict], max_sec: float) -> list[dict]:
    """max_sec보다 긴 장면을 고르게 나눈다. 앞에서부터 max_sec씩 자르면 15초 장면이 12초 + 3초가 되어, 3초 장면마다
    따로 해설·제목을 써서 "반죽을 체에 거릅니다"가 목차 5개로 되풀이됐다(2026-11-12 크레페)."""
    step = int(max_sec * 1000)
    out = []
    for s in scenes:
        a, b = s["startMs"], s["endMs"]
        n = max(1, -(-(b - a) // step))
        out += [{"startMs": a + (b - a) * k // n, "endMs": a + (b - a) * (k + 1) // n} for k in range(n)]
    return out


async def analyze_opensource(inf, title: str | None, files: dict, work: Path, duration_ms: int, progress,
                             gms: GmsClient | None, job_id: int | None, db=None) -> tuple[dict, str]:
    """오픈소스 경로: 받아쓰기·장면·화면 글자·줄거리·해설·요약을 나눠 분석해 Gemini 형식(raw)으로 모은다."""
    from app.pipeline.video import drop_repeated_actions, drop_said, sound_lines  # video가 local을 불러와서 여기서 부른다

    playback, wav = files["playback"], files["wav"]
    # 받아쓴 말이 없는 영상인가(장면 길이·사진 수가 달라진다). 받아쓰기가 끝나면 알린다
    silent_known: asyncio.Future = asyncio.get_running_loop().create_future()
    stt_segments: list[dict] = []  # 받아쓰기 원문 조각(사진 시각을 고를 때 대사 시작 시각으로 쓴다)

    async def look() -> tuple[list[dict], list[list[Path]], list[list[str]]]:
        """화면 쪽: 장면 찾기 → 장면 사진 → 화면 글자. 소리 쪽(받아쓰기·번역·효과음·줄거리)과 나란히 돈다.
        사진 뽑기는 번역·효과음을 기다릴 까닭이 없고 줄거리는 화면 글자가 필요 없다."""
        scenes = await asyncio.to_thread(detect_scenes, playback, duration_ms)
        silent = await silent_known
        if silent:
            scenes = split_long(scenes, SILENT_MAX_SCENE_SEC)
        starts = [x["startMs"] for x in stt_segments] if FRAME_MODE == "dialogue" else []
        extra = [[m for m in starts if s["startMs"] <= m < s["endMs"]] for s in scenes]
        shots = await asyncio.to_thread(frames, playback, work, scenes, frames_for_silent if silent else frames_for, extra)
        flat = [p for group in shots for p in group]
        t0 = time.monotonic()
        texts = (await inf.ocr(flat))["texts"] if flat else []
        await inference.log_remote(db, "DESCRIBE", "paddleocr", t0, job_id=job_id)  # purpose에 OCR 없음
        return scenes, shots, texts

    async def story_pass() -> dict:
        """장면을 따로 보기 전에 영상 전체(3초 간격 사진 + 소리 + 대사)로 핵심 사건과 인물·물건 이름을 먼저 정한다(32B).
        장면만 따로 봐서 핵심 장면을 놓치고 같은 물건·사람을 장면마다 다르게 불렀다. 문장 규칙은 주지 않는다(주면 사건 대신
        문장을 채웠다). 32B가 꺼져 있으면 빈 결과로 장면별 해설만 한다."""
        t0 = time.monotonic()
        r = await inf.story({"title": title or "", "guide": prompts.genre_guide(title)[0] + SCENE_CAST_GUIDE,
                             "frames": await timeline_job, "sounds": sound_lines(sound_events, 0, duration_ms),
                             "transcript": "\n".join(f"{x['startMs'] // 1000}초 {x['text']}" for x in segs)})
        await inference.log_remote(db, "DESCRIBE", f"story:{r.get('model')}", t0, job_id=job_id)  # purpose에 STORY 없음
        return r

    look_job = asyncio.create_task(look())
    timeline_job = asyncio.create_task(asyncio.to_thread(timeline_frames, playback, work, duration_ms))
    sound_job = asyncio.create_task(inf.sounds(wav))
    story_job = None
    try:
        await progress(6)
        t0 = time.monotonic()
        stt = await inf.transcribe(wav)
        await inference.log_remote(db, "STT", str(stt.get("model", "")), t0, job_id=job_id)
        stt_segments.extend(stt["segments"])
        silent_known.set_result(not stt["segments"])
        language = stt.get("language")
        await progress(9)
        t0 = time.monotonic()
        segs = await translate_segments(inf, stt["segments"], language, title, gms, job_id)
        if any(x.get("original") for x in segs):
            await inference.log_remote(db, "STT", "translate", t0, job_id=job_id)  # purpose에 TRANSLATE 없음
        sound_events = (await sound_job).get("events", [])
        story_job = asyncio.create_task(story_pass())
        scenes, shots, texts = await look_job
        await progress(11)
        story = await story_job
    except BaseException:
        for job in (look_job, timeline_job, sound_job, story_job):
            if job:
                job.cancel()
        raise
    ocr_by_scene, k = [], 0
    for group in shots:
        words: list[str] = []
        for t in texts[k:k + len(group)]:
            words += [w for w in t if w not in words]
        ocr_by_scene.append(words)
        k += len(group)
    ocr_by_scene = clean_ocr(ocr_by_scene)

    await progress(13)
    events = story.get("events", [])
    cast = ground_names(story.get("names", []), title, ocr_by_scene, segs)
    foreign = bool(segs) and language not in (None, "ko")
    silent = not segs  # 받아쓴 말이 없다(애니메이션·음악만·자막 예능)
    captions = silent and sum(len(w) for w in ocr_by_scene) >= CAPTIONS_PER_MIN * duration_ms / 60000
    payload = {"title": title or "", "guide": (build_guide(title) + (FOREIGN_GUIDE if foreign else "") + (ACTION_GUIDE if silent else "")
                                               + (CAPTION_GUIDE if captions else "") + SCENE_FIX_GUIDE
                                               + (SPEECH_GUIDE if SPEECH_FILTER else "")),
               "storyline": "\n".join(f"{e['atMs'] // 1000}초 {e['text']}" for e in events),
               "names": ", ".join(f"{n['name']}({n['what']})" if n.get("what") else n["name"] for n in cast),
               "scenes": [{"startMs": s["startMs"], "endMs": s["endMs"],
                           "transcript": " ".join(x["text"] for x in segs if overlaps(x, s)),
                           "sounds": sound_lines(sound_events, s["startMs"], s["endMs"]),
                           "events": " ".join(e["text"] for e in events if s["startMs"] <= e["atMs"] < s["endMs"]),
                           "ocr": ocr_by_scene[i], "frames": [str(p) for p in shots[i]],
                           "frameMs": frame_times(shots[i])} for i, s in enumerate(scenes)]}
    t0 = time.monotonic()
    # 화면 문구는 장면 해설을 쓰는 동안 고른다
    cands = screen_candidates(scenes, shots, texts, ocr_by_scene, segs) if SCREEN_LINES else []
    notes_job = asyncio.create_task(pick_screen_lines(inf, title, cands, duration_ms)) if cands else None
    try:
        desc = await describe_scenes(inf, payload)
    except BaseException:
        if notes_job:
            notes_job.cancel()
        raise
    await inference.log_remote(db, "DESCRIBE", str(desc.get("model", "")), t0, job_id=job_id)
    notes = await notes_job if notes_job else []
    for sc, sd in zip(desc["scenes"], scenes):
        kept = [{**ln, "text": finish_sentence(ln["text"])} for ln in sc["lines"]
                if finish_sentence(ln["text"]) and not looks_like_json(ln["text"]) and not HAN_CHAR.search(ln["text"])]
        kept = drop_early(kept, segs)
        # 화면 문구는 문장 수 한도와 따로 넣는다. 해설이 이미 그 글자를 썼으면 넣지 않는다
        shown = [{"atMs": n["atMs"], "level": 1, "text": n["text"]} for n in notes if sd["startMs"] <= n["atMs"] < sd["endMs"]
                 and not all(any(_norm(q) in _norm(ln["text"]) for ln in kept) for q in n["quotes"])]
        sc["lines"] = spread_lines(cap_lines(kept, sd["endMs"] - sd["startMs"]) + shown, sd)
    drop_repeats(desc["scenes"])
    thin_levels(desc["scenes"])
    scenes, desc["scenes"], ocr_by_scene = merge_similar_scenes(scenes, desc["scenes"], ocr_by_scene)
    lines = [ln for sc in desc["scenes"] for ln in sc["lines"]]
    await progress(17)
    t0 = time.monotonic()
    summ = await inf.summarize({"title": title or "", "transcript": " ".join(x["text"] for x in segs),
                                "sceneTitles": [sc["title"] for sc in desc["scenes"]],
                                "lines": [e["text"] for e in events] + [ln["text"] for ln in lines]})  # 줄거리를 앞에(요약이 사건을 담게)
    await inference.log_remote(db, "SUMMARY", str(summ.get("model", "")), t0, job_id=job_id)

    raw = to_raw(segs, language, scenes, desc["scenes"], ocr_by_scene, lines, summ)
    # 영상 보기 경로와 같은 거르기(대사 옮기기·같은 동작 되풀이) + 옷·"말한다"만 있는 문장
    ordered = sorted(raw["lines"], key=lambda x: (to_ms(x["at"]), x["level"]))
    said = drop_said(ordered, segs)
    # 핵심 사건(level 1)은 같은 동작 되풀이로 빼지 않는다: "망토를 입자 몸이 사라집니다"가 앞의 "망토를 꺼냅니다"와 같은
    # 동작으로 잡혀 빠졌다(2026-11-12 해리포터)
    kept_ids = {id(x) for x in drop_repeated_actions(said)}
    raw["lines"] = drop_idle([x for x in said if x["level"] == 1 or x.get("key") or id(x) in kept_ids])
    for x in raw["lines"]:
        x.pop("key", None)
    if SPEECH_FILTER:
        raw["lines"] = drop_speech_acts(raw["lines"])
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
        "lines": [{"at": mmss(ln["atMs"]), "level": ln["level"], "text": ln["text"], **({"key": True} if ln.get("key") else {})}
                  for ln in lines],
    }


# ---------- Gemini 엔진(데모 upload_gemini.py) ----------

LONG_VIDEO_SEC = 180
MODEL_LONG, MODEL_SHORT = "gemini-3.5-flash", "gemini-3.8-flash"
# inline_data는 base64로 들어가 1.33배가 되고 요청 전체 한도가 20MB라 원본은 약 14MB까지만 된다. 19MB로 두었을 때
# 16.3MB 영상(base64 약 21.7MB)이 GMS에서 곧바로 "429 잠시 후 다시 시도"로 거절됐다(2026-11-09 데모 실측, 작은 사본은 통과)
INLINE_MAX_BYTES = 14 * 1024 * 1024
GEMINI_AUDIO_KBPS = 32  # Gemini 사본의 소리(모노 16kHz). 말소리만 알아들으면 된다. 긴 영상은 더 줄인다


def gemini_copy(playback: Path, duration_sec: int) -> Path:
    """inline_data 한도를 넘는 재생용 파일은 Gemini에 넣을 작은 사본으로(640px 이하·초당 2장·모노 16kHz).
    Gemini는 영상을 초당 1장으로 보므로 화질을 줄여도 해설은 거의 같다. GPU 서버가 끊겨 긴 업로드 영상도 Gemini로 갈 때 쓴다."""
    if playback.stat().st_size <= INLINE_MAX_BYTES:
        return playback
    out = playback.parent / "gemini.mp4"
    total_kbps = INLINE_MAX_BYTES * 8 * 0.85 / max(1, duration_sec) / 1000  # 한도의 85%를 목표로(60분이면 약 38kbps)
    audio_kbps = int(min(GEMINI_AUDIO_KBPS, max(12, total_kbps * 0.4)))
    for share in (1.0, 0.5):  # 한 번에 안 들어가면 화면 몫을 절반으로 한 번 더
        video_kbps = max(8, int((total_kbps - audio_kbps) * share))
        _ff("-i", str(playback), "-vf", "scale='min(640,iw)':-2,fps=2", "-c:v", "libx264", "-preset", "veryfast",
            "-b:v", f"{video_kbps}k", "-maxrate", f"{video_kbps}k", "-bufsize", f"{video_kbps * 2}k", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-ac", "1", "-ar", "16000", "-b:a", f"{audio_kbps}k", str(out))
        if out.stat().st_size <= INLINE_MAX_BYTES:
            return out
    return out  # 그래도 크면 analyze_gemini가 한도 오류를 낸다


async def analyze_gemini(gms: GmsClient, title: str | None, playback: Path, duration_sec: int, job_id: int | None) -> tuple[dict, str]:
    """재생용 MP4를 Gemini에 inline_data로 넣어 유튜브와 같은 누적형 해설 JSON을 받는다(크레딧 사용)."""
    model = MODEL_LONG if duration_sec >= LONG_VIDEO_SEC else MODEL_SHORT
    data = (await asyncio.to_thread(gemini_copy, playback, duration_sec)).read_bytes()
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
    if gms and has_gms and not await inf.healthy():
        # GPU 서버(터널)가 끊겼으면 H200 엔진을 하나씩 기다리지 않고 바로 Gemini로(유튜브 영상과 같은 방식, 2026-11-06)
        errors.append("h200: 연결 안 됨")
        order = ["gemini"]
        log.warning("H200이 응답하지 않아 업로드 분석을 Gemini로 job=%s", job_id)
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
