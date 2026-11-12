"""업로드 영상 파이프라인 — 상황 먼저 해설(데모 backend/app/pipeline/situation.py에서 옮김, 2026-11-06. 사용자: "대사 받아쓰고 목소리로 짝짓고 사진으로 인물 짝짓고, 상황을 먼저 파악하고 장면 목차,
해설 대본, 해설을 시간에 맞게 끼워 넣기").

옛 방식은 32B가 영상 조각을 보며 인물 이름·해설을 한 번에 썼다. 조각마다 겉모습으로 인물을 짐작해 히데오(남자)를 단발머리
여성(금서희)에게 붙였고, "의사가 필립의 발목 진찰을 마치고 히데오에게 약을 요청한다"처럼 누가 누구에게 하는지가 뒤바뀌었다
(정답: 의사가 금서희의 발목을 진찰하고 히데오가 의사에게 약을 부탁함, 2026-11-05 100일의 거짓말 4화). 그래서 나눈다:

1) 듣기: 받아쓰기·목소리로 화자 나누기(video.analyze_situation에서)
2) 얼굴: 얼굴로 같은 사람끼리 묶어 P1, P2…(H200 /faces, 서버 버전 23). 32B에 보낼 영상의 얼굴에 번호표를 그려
   조각이 달라도 같은 사람은 같은 번호가 되게 한다. 얼굴이 없는 영상(애니메이션)은 32B가 겉모습으로 C1, C2…를 붙인다
3) 보기: 32B가 영상 조각마다 본 일만 기록(누가 무엇을, 몇 초에). 해설은 아직 쓰지 않는다
4) 상황 파악: 얼굴 사진·사람 목록·목소리와 얼굴이 함께 나온 횟수·대사(누가, 화면에 누가)·본 일을 한 번에 32B에 보내
   이름·말한 사람·상황 흐름·장면 목차·요약을 정한다
5) 해설 대본: 상황 흐름과 본 일로 해설을 쓴다(글만, 조각마다 동시에). 대사 사이 빈틈을 함께 준다
6) 끼워 넣기·검사는 video.py(tidy_video_lines, verify_lines)
업로드 영상은 이름을 쓰지 않는다: 성별+겉모습 호칭("갈색 코트 여성"), 같은 사람은 끝까지 같은 호칭(2026-11-06 사용자 결정).
H200 gpu_server 버전 23 이상이 필요하다(/faces, /generate_json 사진, /speakers WeSpeaker).
"""
import asyncio
import base64
import re
from collections import Counter
from collections.abc import Awaitable, Callable
from pathlib import Path

from app import inference
from app.errors import WorkerError
from app.pipeline import local
from app.pipeline.narration_schema import to_ms

OnDone = Callable[[int, int], Awaitable[None]] | None


class Ticker:
    """여럿이 하나씩 끝낼 때마다 (끝낸 수, 전체)를 알린다(진행률을 실제로 끝낸 만큼)."""

    def __init__(self, total: int, fn: OnDone):
        self.total, self.fn, self.done = total, fn, 0

    async def tick(self) -> None:
        self.done += 1
        if self.fn:
            await self.fn(self.done, self.total)

FACE_FPS = 2
FACE_WIDTH = 960  # 얼굴 찾기용 사본 폭. 640이면 먼 얼굴이 작아 못 찾는다
FACE_MIN_COUNT = 6  # 이보다 적게(3초 미만) 나온 얼굴 무리는 버린다(뒷모습·스치는 사람)
FACE_MAX_PEOPLE = 10
ID = r"(?<![A-Za-z0-9])([PXC][0-9]{1,2})(?![0-9])"
ID_PATTERN = "^[PXC][0-9]{1,2}$"
WINDOW_MS = 20_000
SCRIPT_CHUNK_MS = 120_000  # 해설 대본은 2분씩 동시에(글만이라 빠름)
GAP_MIN_MS = 2500  # 이보다 짧은 대사 사이 틈은 빈틈으로 치지 않는다


def text_rule(n: int) -> dict:
    from app.pipeline.video import no_cjk
    return {"type": "string", "maxLength": n, "pattern": no_cjk(n)}


MMSS = {"type": "string", "pattern": "^[0-9]{2}:[0-9]{2}$"}


# ---------- 2) 얼굴 ----------

def face_copy(playback: Path) -> Path:
    out = playback.parent / "video960.mp4"
    if not out.exists():
        local._ff("-i", str(playback), "-vf", f"scale={FACE_WIDTH}:-2,fps={FACE_FPS}", "-an", "-c:v", "libx264", "-crf", "23",
                   "-preset", "veryfast", str(out))
    return out


async def find_faces(inf, playback: Path) -> dict:
    """얼굴로 묶은 사람과 장마다 얼굴 위치. 서버가 못 하거나 얼굴이 없으면 빈 결과(겉모습 번호로 진행)."""
    empty = {"persons": [], "frames": [], "width": FACE_WIDTH, "model": None}
    if not hasattr(inf, "faces"):
        return empty
    try:
        r = await inf.faces(await asyncio.to_thread(face_copy, playback))
    except (inference.InferenceError, WorkerError):
        return empty
    keep = [p for p in r.get("persons", []) if p["count"] >= FACE_MIN_COUNT][:FACE_MAX_PEOPLE]
    ids = {p["id"] for p in keep}
    frames = [{"t": f["t"], "faces": [x for x in f["faces"] if x["id"] in ids]} for f in r.get("frames", [])]
    return {"persons": keep, "frames": [f for f in frames if f["faces"]], "width": r.get("width") or FACE_WIDTH,
            "model": r.get("model") if keep else None}


def label_video(video: Path, faces: dict) -> Path:
    """32B에 보낼 640px 사본의 얼굴에 노란 번호표를 그린다(초당 2장 사본이라 장 k = k/2초)."""
    import cv2
    out = video.parent / "video640_faces.mp4"
    if out.exists():
        return out
    by_t = {round(f["t"] * FACE_FPS): f["faces"] for f in faces["frames"]}
    cap = cv2.VideoCapture(str(video))
    fps = cap.get(cv2.CAP_PROP_FPS) or FACE_FPS
    raw = video.parent / "video640_faces_raw.avi"
    writer, k = None, 0
    while True:
        ok, img = cap.read()
        if not ok:
            break
        if writer is None:
            writer = cv2.VideoWriter(str(raw), cv2.VideoWriter_fourcc(*"MJPG"), fps, (img.shape[1], img.shape[0]))
            scale = img.shape[1] / faces["width"]
        for f in by_t.get(round(k / fps * FACE_FPS), []):
            x, y, w, h = [int(v * scale) for v in f["box"]]
            cv2.rectangle(img, (x, y), (x + w, y + h), (0, 230, 255), 2)
            ty = y - 6 if y > 22 else y + h + 18
            cv2.rectangle(img, (x, ty - 16), (x + 14 + 11 * len(f["id"]), ty + 4), (0, 230, 255), -1)
            cv2.putText(img, f["id"], (x + 3, ty), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 2)
        writer.write(img)
        k += 1
    cap.release()
    if writer is None:
        return video
    writer.release()
    local._ff("-i", str(raw), "-c:v", "libx264", "-crf", "26", "-preset", "veryfast", "-pix_fmt", "yuv420p", str(out))
    raw.unlink(missing_ok=True)
    return out


def face_sheet(persons: list[dict]) -> str | None:
    """얼굴 사진 모음 한 장(번호 붙임, 8명까지) base64 jpg."""
    import cv2
    import numpy as np
    tiles = []
    for p in persons[:8]:
        img = cv2.imdecode(np.frombuffer(base64.b64decode(p["crop"]), np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            continue
        img = cv2.resize(img, (160, 160))
        cv2.rectangle(img, (0, 0), (44, 24), (0, 230, 255), -1)
        cv2.putText(img, p["id"], (4, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)
        tiles.append(img)
    if not tiles:
        return None
    while len(tiles) % 4:
        tiles.append(np.full_like(tiles[0], 255))
    sheet = np.vstack([np.hstack(tiles[i:i + 4]) for i in range(0, len(tiles), 4)])
    ok, jpg = cv2.imencode(".jpg", sheet, [cv2.IMWRITE_JPEG_QUALITY, 88])
    return base64.b64encode(jpg.tobytes()).decode() if ok else None


def on_screen(faces: dict, a_ms: int, b_ms: int) -> list[str]:
    """[a, b] 동안 화면에 얼굴이 보인 번호(많이 보인 순)."""
    cnt = Counter(x["id"] for f in faces["frames"] if a_ms <= f["t"] * 1000 <= b_ms for x in f["faces"])
    return [k for k, _ in cnt.most_common()]


VOICE_SPLIT_HZ = 165  # 목소리 높이(중앙값)가 이보다 낮으면 남성, 높으면 여성으로 본다(성인 남 85~155, 여 165~255Hz)
VOICE_MARGIN_HZ = 12  # 경계 근처는 판단하지 않는다


def voice_gender(wav: Path, segs: list[dict]) -> None:
    """대사 줄마다 목소리 높이로 남녀를 짐작해 seg["voice"]("남"/"여"/None), seg["f0"]에 적는다. 화자 나누기가 남녀를 한 화자로
    묶어도(2026-11-05 100일의 거짓말) 줄마다 성별은 따로 알 수 있다. 자기상관으로 40ms마다 기본 주파수를 재고 중앙값을 쓴다."""
    import wave

    import numpy as np
    if not wav or not Path(wav).exists():
        return
    with wave.open(str(wav), "rb") as w:
        sr = w.getframerate()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    n, hop = int(sr * 0.04), int(sr * 0.02)
    lo, hi = int(sr / 320), int(sr / 75)  # 75~320Hz
    for s in segs:
        a, b = int(s["startMs"] * sr / 1000), int(s["endMs"] * sr / 1000)
        seg = x[a:b]
        if len(seg) < n:
            continue
        loud = np.sqrt(np.mean(seg ** 2))
        f0s = []
        for i in range(0, len(seg) - n, hop):
            fr = seg[i:i + n] - seg[i:i + n].mean()
            if np.sqrt(np.mean(fr ** 2)) < loud * 0.5:  # 조용한 틈은 건너뛴다
                continue
            ac = np.correlate(fr, fr, mode="full")[n - 1:]
            if ac[0] <= 0:
                continue
            ac = ac / ac[0]
            win = ac[lo:hi]
            best = float(win.max())
            # 가장 높은 봉우리의 90% 넘는 첫 봉우리(두 배 주기를 고르는 한 옥타브 낮은 실수를 줄인다). 범위 끝에 걸리면 잡음
            k = lo + int(np.argmax(win >= best * 0.9))
            if best > 0.45 and lo + 1 < k < hi - 2:
                f0s.append(sr / k)
        if len(f0s) >= 5:
            f0 = float(np.median(f0s))
            s["f0"] = round(f0)
            s["voice"] = "남" if f0 < VOICE_SPLIT_HZ - VOICE_MARGIN_HZ else "여" if f0 > VOICE_SPLIT_HZ + VOICE_MARGIN_HZ else None


# ---------- 3) 보기 ----------

LOOK_PROMPT = """당신은 시각장애인을 위한 화면해설을 준비하는 기록자입니다. 해설은 나중에 따로 씁니다.
지금은 이 영상에서 화면에 보이는 일을 시간 순서대로 정확히 기록합니다. 추측하지 않고 보이는 것만 적습니다.
당신은 소리를 들을 수 없습니다. 맨 아래 '대사(받아쓰기)'와 '소리 사건'이 이 영상의 소리입니다. 누가 무엇을 하는지 판단할 때 함께 봅니다.

사람 번호
{id_rule}
- 사람을 부를 때는 번호만 씁니다(이름·"남성"·"여성"으로 부르지 않음). 대사나 화면 글자에 이름이 나와도 이름을 쓰지 않습니다.

cast — 이 부분에 나오는 사람(동물·캐릭터 포함)
- id, gender(남·여·모름), age(어린이·청소년·청년·중년·노년·모름), look(다른 사람과 가를 수 있는 겉모습: 머리 모양·옷 색·안경·모자, 30자 이내).

windows — 20초 구간마다(구간은 정해져 있습니다)
- place: 그 구간의 장소(예: "한옥 진료실", "숲길", "찻집 안").
- seen: 그 구간에 일어나는 일을 시간 순서대로 1~5개. at은 그 일이 화면에 처음 보이는 초(구간 시작 시각을 그대로 쓰지 않음).
  who는 그 일을 하는 사람 번호, to는 그 일을 받는 사람 번호(없으면 빈 목록).
  what은 "P2가 P1의 어깨에 담요를 덮어 준다"처럼 누가 누구에게 무엇을 하는지 한 문장. 행동하는 사람과 받는 사람을 바꾸지 않습니다.
  앞 구간에서 이미 적은 일을 다시 쓰거나 다음 구간으로 미루어 쓰지 않습니다.
  눈에 보이는 행동만 적습니다. 대사를 옮겨 적거나 "~라고 말한다", "말을 한다"처럼 말하는 것만 적지 않습니다(대사는 따로 있습니다).
  손·발처럼 얼굴 없이 몸의 일부만 보이면 앞뒤 대사로 누구의 것인지 판단합니다. 누가 다쳤다·아프다고 자기 몸 이야기를
  했는지(목소리 성별도 함께), 옷·신발·앉은 자리를 봅니다. 바로 다음 장면에 얼굴이 나온 사람의 몸으로 짐작하지 않습니다.
- detail: 그 구간의 표정·몸짓·옷차림·장소 모습 0~3개(at, what). 크게 보이는 분명한 것만.

screen_text — 새로 나온 화면 글자(at, text, kind). 한자는 한글 독음으로(上命下服 → 상명하복). 엔딩 크레딧 이름 나열은 적지 않음.
category — 영상 종류.

모든 글은 한국어 한글. 한자·일본어·중국어를 쓰지 않습니다.
"""
ID_RULE_FACES = """- 사람 얼굴에 노란 번호표(P1, P2 …)가 붙어 있습니다. 얼굴로 묶은 번호라 영상 전체에서 같은 사람입니다.
- 번호표가 보이는 사람은 그 번호로 부릅니다. 번호표가 없는 사람(뒷모습·옆모습·작은 얼굴)은 옷·위치·앞뒤 장면으로 같은 사람을 찾아
  그 번호를 쓰고, 처음 보는 사람이면 X1, X2 …를 새로 붙입니다.
- 얼굴 번호표의 사람(겉모습은 앞에서 본 것):
{known}"""
ID_RULE_NONE = """- 사람(캐릭터)마다 C1, C2 …를 붙입니다. 겉모습(색·귀 모양·크기·옷)으로 구별합니다.
{known}"""
LOOK_CHUNK = """
이 영상은 긴 영상의 한 부분입니다(전체 {total} 가운데 {a}~{b}). 모든 시각(at)은 이 부분의 처음을 00:00으로 셉니다.
아래 대사·소리 시각도 그렇게 맞춰 두었습니다.
"""


def shift_look(r: dict, offset_ms: int) -> dict:
    """조각 기준 시각(00:00부터) → 영상 전체 시각."""
    from app.pipeline.video import mmss

    def move(x: dict, *keys: str) -> None:
        for k in keys:
            if k in x:
                x[k] = mmss(to_ms(x[k]) + offset_ms)
    for w in r.get("windows", []):
        move(w, "from", "to")
        for x in w.get("seen", []) + w.get("detail", []):
            move(x, "at")
    for t in r.get("screen_text", []):
        move(t, "at")
    return r


def look_schema(spans_ms: tuple[int, int], categories: list[str]) -> dict:
    from app.pipeline.video import mmss
    a, b = spans_ms
    ident = {"type": "string", "pattern": ID_PATTERN}
    event = {"type": "object", "properties": {"at": MMSS, "who": {"type": "array", "items": ident, "maxItems": 4},
                                              "to": {"type": "array", "items": ident, "maxItems": 3}, "what": text_rule(70)},
             "required": ["at", "who", "to", "what"], "additionalProperties": False}
    detail = {"type": "object", "properties": {"at": MMSS, "what": text_rule(60)}, "required": ["at", "what"],
              "additionalProperties": False}
    windows = []
    for s in range(a, b, WINDOW_MS):
        e = min(b, s + WINDOW_MS)
        windows.append({"type": "object", "properties": {
            "from": {"const": mmss(s)}, "to": {"const": mmss(e)}, "place": text_rule(20),
            "seen": {"type": "array", "items": event, "minItems": 1, "maxItems": 5},
            "detail": {"type": "array", "items": detail, "maxItems": 3}},
            "required": ["from", "to", "place", "seen", "detail"], "additionalProperties": False})
    person = {"type": "object", "properties": {"id": ident, "gender": {"enum": ["남", "여", "모름"]},
                                               "age": {"enum": ["어린이", "청소년", "청년", "중년", "노년", "모름"]},
                                               "look": text_rule(40)},
              "required": ["id", "gender", "age", "look"], "additionalProperties": False}
    shown = {"type": "object", "properties": {"at": MMSS, "text": text_rule(50),
                                              "kind": {"enum": ["제목", "이름표", "자막", "간판", "기타"]}},
             "required": ["at", "text", "kind"], "additionalProperties": False}
    return {"type": "object", "properties": {
        "category": {"enum": categories},
        "cast": {"type": "array", "items": person, "minItems": 1, "maxItems": 10},
        "windows": {"type": "array", "prefixItems": windows, "items": False, "minItems": len(windows), "maxItems": len(windows)},
        "screen_text": {"type": "array", "items": shown, "maxItems": 8}},
        "required": ["category", "cast", "windows", "screen_text"], "additionalProperties": False}


def known_people(persons: list[dict], cast: dict[str, dict]) -> str:
    rows = []
    for p in persons:
        c = cast.get(p["id"], {})
        rows.append(f"  {p['id']}: " + (f"{c.get('gender', '')}·{c.get('age', '')}, {c.get('look', '')}" if c else "(아직 못 봄)"))
    for k, c in cast.items():
        if not any(p["id"] == k for p in persons):
            rows.append(f"  {k}: {c.get('gender', '')}·{c.get('age', '')}, {c.get('look', '')}")
    return "\n".join(rows) or "  (아직 없음)"


async def look_parts(inf, video: Path, title: str, segs: list[dict], sound_events: list[dict], duration_ms: int,
               faces: dict, guide: str, on_done: OnDone = None) -> tuple[dict, list[dict]]:
    """조각마다 본 일만 기록. 첫 조각에서 사람 겉모습을 정하고 나머지 조각은 그 목록을 받아 동시에(32B 3개까지)."""
    from app.pipeline.video import chunk_spans, mmss, sound_lines, video_part
    from app.pipeline.narration_schema import CATEGORY_CODE
    spans = chunk_spans(duration_ms)
    cats = list(CATEGORY_CODE)
    cast: dict[str, dict] = {}

    async def one(k: int) -> dict:
        # 조각 안 시각은 0부터(옛 방식과 같게: 모델은 받은 영상의 처음을 0으로 센다). 끝나면 영상 전체 시각으로 옮긴다
        a, b = spans[k]
        part = video if len(spans) == 1 else await asyncio.to_thread(video_part, video, a, b)
        mine = [{**x, "startMs": max(0, x["startMs"] - a), "endMs": x["endMs"] - a} for x in segs
                if x["startMs"] < b and x["endMs"] > a]
        transcript = "\n".join(f"{mmss(x['startMs'])}~{mmss(x['endMs'])} "
                               + (f"[{voice_label(x['who'])}] " if x.get("who") else "") + x["text"] for x in mine) or "(없음)"
        sounds = sound_lines([{**e, "startMs": max(0, e["startMs"] - a), "endMs": e["endMs"] - a} for e in sound_events], 0, b - a)
        known = known_people(faces["persons"], cast)
        id_rule = (ID_RULE_FACES if faces["persons"] else ID_RULE_NONE).format(known=known)
        prompt = LOOK_PROMPT.format(id_rule=id_rule) + guide + f"\n영상 제목: \"{title}\"\n"
        if len(spans) > 1:
            prompt += LOOK_CHUNK.format(total=mmss(duration_ms), a=mmss(a), b=mmss(b))
        prompt += f"\n소리 사건(초, 자동 분석이라 틀릴 수 있음):\n{sounds or '(없음)'}\n대사(받아쓰기, 시작~끝):\n{transcript}\n"
        r = await inf.describe_video(part, prompt, look_schema((0, b - a), cats))
        return {"span": [a, b], "prompt": prompt, "result": shift_look(r["result"], a), "model": r.get("model", inf.name)}

    ticker = Ticker(len(spans), on_done)
    first = await one(0)
    await ticker.tick()
    for c in first["result"].get("cast", []):
        cast.setdefault(c["id"], c)
    parts = [first]
    if len(spans) > 1:
        gate = asyncio.Semaphore(3)  # 32B는 3개까지 동시에

        async def later(k):
            async with gate:
                try:
                    return await one(k)
                finally:
                    await ticker.tick()
        parts += list(await asyncio.gather(*(later(k) for k in range(1, len(spans)))))
    for p in parts[1:]:
        for c in p["result"].get("cast", []):
            cast.setdefault(c["id"], c)
    seen, details, places, texts = [], [], [], []
    for p in parts:
        a, b = p["span"]
        for w in p["result"].get("windows", []):
            lo, hi = to_ms(w["from"]), max(to_ms(w["from"]), to_ms(w["to"]) - 1000)
            places.append({"from": lo, "to": to_ms(w["to"]), "place": w.get("place", "")})
            for x in w.get("seen", []):
                seen.append({**x, "ms": min(max(to_ms(x["at"]), lo), hi), "place": w.get("place", "")})
            for x in w.get("detail", []):
                details.append({**x, "ms": min(max(to_ms(x["at"]), lo), hi)})
        for t in p["result"].get("screen_text", []):
            texts.append({**t, "ms": min(max(to_ms(t["at"]), a), b - 1)})
    return {"category": first["result"].get("category", "기타"), "cast": cast, "seen": sorted(seen, key=lambda x: x["ms"]),
            "details": sorted(details, key=lambda x: x["ms"]), "places": places,
            "screen_text": sorted(texts, key=lambda x: x["ms"])}, parts


# ---------- 4-1) 대사마다 말한 사람 ----------
# 목소리 무리만 믿으면 두 남자(히데오·모자 쓴 남자)가 한 화자로 묶여 이름이 뒤바뀌었다(wavlm, 2026-11-05). 줄마다 따로 정하게 하면
# 같은 목소리(WeSpeaker 무리 C)의 줄을 실행할 때마다 다르게 나눴다(P1 4·P3 4). 그래서 줄이 많은 목소리 무리는 그 줄을 한꺼번에 보여
# 주인을 먼저 정하고("제 처의 약을…" + "서희를 데려가도…" → 모자 쓴 남자), 나머지 줄만 하나씩 정한다

VOICE_PROMPT = """영상 "{title}"의 목소리 무리마다 그 목소리의 주인 번호를 정합니다.
목소리 무리는 목소리 특징으로 자동으로 나눈 것입니다(같은 무리 = 대체로 한 사람. 알파벳은 사람 번호와 상관없음).
{sheet_note}사람 목록(번호: 성별·나이, 겉모습):
{people}

무리별 대사(시각 [목소리 높이로 잰 성별 | 그때 화면에 보인 얼굴] 말):
{groups}

판단 근거
- 성별: 남성 목소리가 많은 무리의 주인은 남자, 여성 목소리가 많으면 여자입니다.
- 내용: 자기 이야기("저는", "제가")와 하는 일(부탁·질문)이 그 사람의 처지·장면과 맞아야 합니다.
  "○○상", "○○ 씨"라고 부른 무리의 주인은 ○○이 아닙니다.
- 화면: 그 무리가 말할 때 여러 번 보이는 얼굴. 듣는 사람 얼굴만 비추는 장면도 많으니 한두 번으로 정하지 않습니다.
섞여 있어 한 사람으로 정할 수 없으면 빈 문자열.
"""
LINE_PROMPT = """영상 "{title}"의 대사 가운데 아직 말한 사람을 정하지 못한 줄(번호 붙은 줄)의 말한 사람 번호를 정합니다.
{sheet_note}사람 목록(번호: 성별·나이, 겉모습):
{people}

대사(시각 [말한 사람(정한 것) 또는 목소리 무리 · 목소리 성별 | 그때 화면에 보인 얼굴] 말):
{lines}

판단 근거(강한 순)
1) 목소리 성별: "남성 목소리" 줄은 남자가, "여성 목소리" 줄은 여자가 말했습니다(표시가 없으면 이 근거 없음).
2) 대사 흐름: 묻고 답하면 말하는 사람이 바뀝니다. "○○ 씨", "○○야", "○○상"처럼 부르면 말하는 사람은 그 사람이 아니라 부르는
   쪽입니다. 앞뒤의 정한 줄과 이어지는 말은 같은 사람일 수 있습니다.
3) 화면: 말하는 사람은 대개 화면에 보이지만, 듣는 사람 얼굴만 비추는 장면도 많습니다(화면 얼굴만으로 정하지 않음).
화면 밖 목소리(해설자, 라디오)이거나 알 수 없으면 빈 문자열.
"""
VOICE_GROUP_MIN = 3  # 이만큼 넘게 말한 목소리 무리는 무리째 주인을 정한다
VOICE_GROUP_SHOW = 14  # 무리마다 보여 줄 줄 수(고르게 뽑음)
SPEAKER_CHUNK = 40
SPEAKER_CONTEXT = 4


def voice_label(who: str | None) -> str | None:
    """목소리 무리 번호 "화자5" → "목소리 E". 사람 번호(P5)와 숫자가 같으면 32B가 화자5의 말을 P5(한의사)에게 붙였다
    (2026-11-05 100일의 거짓말: 히데오의 "나 좋아한다고요"가 한의사 말이 됨). 사람 번호가 아니면 그대로."""
    m = re.fullmatch(r"화자(\d+)", who or "")
    if not m:
        return who
    n, out = int(m.group(1)), ""
    while n > 0:
        n, r = divmod(n - 1, 26)
        out = chr(65 + r) + out
    return f"목소리 {out}"


def speaker_tag(s: dict, faces: dict) -> str:
    face = ", ".join(on_screen(faces, s["startMs"], s["endMs"])) if faces["persons"] else ""
    voice = {"남": "남성 목소리", "여": "여성 목소리"}.get(s.get("voice"), "")
    left = " · ".join(x for x in (voice_label(s.get("who")), voice) if x)
    return " | ".join(x for x in (left, f"화면 {face}" if face else "") if x) or "?"


async def attribute_speakers(inf, title: str, look: dict, faces: dict, segs: list[dict]) -> str | None:
    """seg["pid"]에 말한 사람 번호를 적는다. 1) 줄이 많은 목소리 무리는 무리째 주인을 정하고(목소리 성별이 다른 줄은 빼고)
    2) 남은 줄은 40줄씩 정한 줄을 앞뒤에 보여 주며 하나씩. 돌려주는 것: 모델 이름."""
    from app.pipeline.video import mmss
    if not segs or not look["cast"]:
        return None
    people = "\n".join(f"  {k}: {c.get('gender', '')}·{c.get('age', '')}, {c.get('look', '')}" for k, c in look["cast"].items())
    sheet = face_sheet(faces["persons"]) if faces["persons"] else None
    sheet_note = "첫 사진은 얼굴 모음입니다(왼쪽 위 번호 = 사람 번호).\n" if sheet else ""
    pid = {"type": "string", "pattern": "^([PXC][0-9]{1,2})?$"}
    model = None
    for x in segs:
        x["pid"] = None

    def tag(x: dict) -> str:
        face = ", ".join(on_screen(faces, x["startMs"], x["endMs"])) if faces["persons"] else ""
        voice = {"남": "남성 목소리", "여": "여성 목소리"}.get(x.get("voice"), "")
        return " | ".join(v for v in (voice, f"화면 {face}" if face else "") if v) or "?"

    # 1) 목소리 무리째
    groups: dict[str, list[dict]] = {}
    for x in segs:
        if x.get("who"):
            groups.setdefault(x["who"], []).append(x)
    big = [k for k, v in sorted(groups.items(), key=lambda kv: -len(kv[1])) if len(v) >= VOICE_GROUP_MIN]
    if big:
        blocks = []
        for k in big:
            rows = groups[k]
            pick = rows if len(rows) <= VOICE_GROUP_SHOW else [rows[round(i * (len(rows) - 1) / (VOICE_GROUP_SHOW - 1))]
                                                               for i in range(VOICE_GROUP_SHOW)]
            g = Counter(x.get("voice") for x in rows if x.get("voice"))
            blocks.append(f"{voice_label(k)} (대사 {len(rows)}줄, 남성 목소리 {g['남']}·여성 목소리 {g['여']}):\n"
                          + "\n".join(f"  {mmss(x['startMs'])} [{tag(x)}] {x['text']}" for x in pick))
        items = [{"type": "object", "properties": {"voice": {"const": voice_label(k)}, "id": pid}, "required": ["voice", "id"],
                  "additionalProperties": False} for k in big]
        schema = {"type": "object", "properties": {"voices": {"type": "array", "prefixItems": items, "items": False,
                                                              "minItems": len(items), "maxItems": len(items)}},
                  "required": ["voices"], "additionalProperties": False}
        try:
            r = await inf.generate_json(VOICE_PROMPT.format(title=title, sheet_note=sheet_note, people=people, groups="\n\n".join(blocks)),
                                  schema, max_tokens=60 + 30 * len(items), images=[sheet] if sheet else None)
            model = r.get("model")
            for k, v in zip(big, r["result"]["voices"]):
                owner = v["id"] if v["id"] in look["cast"] else None
                g = look["cast"].get(owner or "", {}).get("gender")
                for x in groups[k]:  # 목소리 성별이 주인과 다른 줄은 아래에서 따로 정한다
                    if owner and not (x.get("voice") and g in ("남", "여") and x["voice"] != g):
                        x["pid"] = owner
        except inference.InferenceError:
            pass

    # 2) 남은 줄
    todo = [i for i, x in enumerate(segs) if not x["pid"]]

    async def one(chunk: list[int]) -> list[tuple[int, str]]:
        nonlocal model
        lo, hi = max(0, chunk[0] - SPEAKER_CONTEXT), min(len(segs), chunk[-1] + 1 + SPEAKER_CONTEXT)
        mine = set(chunk)
        rows = []
        for i in range(lo, hi):
            x = segs[i]
            if i in mine:
                rows.append(f"  {i + 1}. {mmss(x['startMs'])} [{speaker_tag(x, faces)}] {x['text']}")
            else:
                known = f"말한 사람 {x['pid']}" if x["pid"] else voice_label(x.get("who")) or "?"
                rows.append(f"  (참고) {mmss(x['startMs'])} [{known} | {tag(x)}] {x['text']}")
        items = [{"type": "object", "properties": {"n": {"const": i + 1}, "id": pid}, "required": ["n", "id"],
                  "additionalProperties": False} for i in chunk]
        schema = {"type": "object", "properties": {"lines": {"type": "array", "prefixItems": items, "items": False,
                                                             "minItems": len(items), "maxItems": len(items)}},
                  "required": ["lines"], "additionalProperties": False}
        r = await inf.generate_json(LINE_PROMPT.format(title=title, sheet_note=sheet_note, people=people, lines="\n".join(rows)),
                              schema, max_tokens=60 + 25 * len(items), images=[sheet] if sheet else None)
        model = r.get("model")
        return [(i, x["id"]) for i, x in zip(chunk, r["result"]["lines"])]

    chunks = [todo[k:k + SPEAKER_CHUNK] for k in range(0, len(todo), SPEAKER_CHUNK)]
    gate = asyncio.Semaphore(3)

    async def gated(chunk):
        async with gate:
            return await one(chunk)
    try:
        for part in await asyncio.gather(*(gated(c) for c in chunks)):
            for i, k in part:
                segs[i]["pid"] = k if k in look["cast"] else None
    except inference.InferenceError:
        pass
    return model


# ---------- 4-2) 다친 곳의 주인 ----------
# 얼굴 없이 발만 크게 잡힌 장면을 32B가 다음 장면 사람의 발로 적었다("한의사가 히데오의 발목을 진찰", 정답: 금서희).
# 그 기록과 대사를 다시 32B에 물으면 히데오가 대신 말한 "오른쪽 발목이 많이 부었습니다"를 히데오 자신의 일로 읽어 맞는 기록까지
# 바꿨다(2026-11-05). 한 영상에서 다친 곳은 대개 한 사람의 것이라, 같은 부위를 여러 번 기록했으면 많이 적힌 주인으로 맞춘다.
# 손·팔은 서로 잡는 일이 많아 맞추지 않는다
INJURY = re.compile(ID + r"의 (?:오른쪽 |왼쪽 )?(발목|무릎|손목|발등|상처|이마)")
INJURY_LEAD = 2  # 많이 적힌 주인이 다른 주인보다 이만큼 넘게 많아야 맞춘다


def fix_injury_owners(look: dict) -> list[str]:
    """본 일 기록의 다친 곳 주인을 영상 전체에서 많이 적힌 주인으로 맞춘다. 돌려주는 것: 고친 기록."""
    from app.pipeline.video import mmss
    found: dict[str, list[tuple[dict, re.Match]]] = {}
    for x in look["seen"]:
        for m in INJURY.finditer(x["what"]):
            found.setdefault(m.group(2), []).append((x, m))
    fixes = []
    look["injury_owner"] = {}
    for part, items in found.items():
        cnt = Counter(m.group(1) for _, m in items).most_common()
        if cnt[0][1] - (cnt[1][1] if len(cnt) > 1 else 0) >= INJURY_LEAD:
            look["injury_owner"][part] = cnt[0][0]  # 글(상황 흐름·해설)에서도 맞추려고
        if len(cnt) < 2 or cnt[0][1] - cnt[1][1] < INJURY_LEAD:
            continue
        owner = cnt[0][0]
        for x, m in items:
            old = m.group(1)
            if old != owner:
                x["what"] = re.sub(re.escape(old) + r"의 ((?:오른쪽 |왼쪽 )?" + part + ")", owner + r"의 \1", x["what"], count=1)
                x["to"] = [owner if k == old else k for k in x.get("to", [])] or [owner]
                fixes.append(f"{mmss(x['ms'])} {old}의 {part} → {owner}(영상에서 {part} 주인이 {owner} {cnt[0][1]}번)")
    return fixes


def fix_injury_text(text: str, calls: dict[str, str], owners: dict[str, str]) -> str:
    """글 속 "사토 히데오의 발목"을 다친 곳 주인의 호칭으로("금서희의 발목"). 상황 흐름은 히데오가 대신 말한 "오른쪽 발목이
    많이 부었습니다"를 히데오의 일로 써서 기록을 고쳐도 장면 제목이 틀렸다(2026-11-05)."""
    if not text or not owners:
        return text
    names = sorted({v for v in calls.values() if v}, key=len, reverse=True)
    if not names:
        return text
    for part, owner in owners.items():
        right = calls.get(owner)
        if not right:
            continue
        pat = re.compile("(" + "|".join(re.escape(n) for n in names) + r")의 ((?:오른쪽 |왼쪽 )?" + part + ")")
        text = pat.sub(lambda m: (right if m.group(1) != right else m.group(1)) + "의 " + m.group(2), text)
    return text


def clean_ids(text: str, calls: dict[str, str]) -> str:
    """검사가 고친 문장의 "한의사(P5)", "(얼굴 번호표 P1)"을 지우고 남은 번호는 호칭으로."""
    text = re.sub(r"\s*\((?:얼굴 번호표 )?" + ID + r"\)", "", text)
    return name_ids(text, calls)


# 대사 속 부르는 말. "유필립상과의 관계"처럼 조사가 붙은 언급은 빼고 부르는 꼴만(뒤에 띄어쓰기·문장부호·끝)
CALLING = re.compile(r"(?:^|[\s,.?!])([가-힣]{2,5})\s?(상|씨|님|군)(?=[\s,.?!]|$)|^([가-힣]{2,3})(야|아)(?=[\s,.?!]|$)")


def address_rows(segs: list[dict], faces: dict) -> list[dict]:
    """이름을 부른 줄마다 {ms, word, stem, speaker, cands}. cands = 그때 화면 얼굴 − 말한 사람(듣는 사람 후보)."""
    rows = []
    for s in segs:
        for m in CALLING.finditer(s["text"]):
            stem, tail = (m.group(1), m.group(2)) if m.group(1) else (m.group(3), m.group(4))
            seen = on_screen(faces, s["startMs"], s["endMs"]) if faces["persons"] else []
            rows.append({"ms": s["startMs"], "word": stem + tail, "stem": stem, "speaker": s.get("pid"),
                         "cands": [k for k in seen if k != s.get("pid")]})
    return rows


def series_names(title: str) -> set[str]:
    """제목으로 고른 시리즈 등장인물 사전의 이름(먼작귀: 치이카와·하치와레·우사기·시사)."""
    import json

    from app.pipeline.prompts import characters_dir, series_of
    series = series_of(title)
    if not series:
        return set()
    book = json.loads((characters_dir() / f"{series}.json").read_text(encoding="utf-8"))
    return {c["name"] for c in book["characters"]}


GENDER_WORD = re.compile(r"남성|여성|남자|여자|소년|소녀|아이|아기|할머니|할아버지|캐릭터|강아지|고양이|동물")


def check_labels(people: list[dict], look: dict, rows: list[dict], title: str) -> list[str]:
    """호칭 검사(코드): 대사에서 부른 이름·시리즈 사전 이름이 들어 있거나 성별 낱말이 없으면 겉모습+성별로 다시 만든다.
    32B가 이름을 쓰지 말라 해도 '시사', '히데오'처럼 이름을 붙일 수 있어서(2026-11-06 업로드는 이름 없이로 결정)."""
    names = {r["stem"] for r in rows} | series_names(title)
    fixes = []
    for p in people:
        c = look["cast"].get(p["id"], {})
        word = {"남": "남성", "여": "여성"}.get(c.get("gender"), "캐릭터" if not c.get("gender") or c.get("gender") == "모름" else "사람")
        call = re.sub(r"\s*(상|씨|님|군|양)$", "", p.get("call") or "").strip()
        leaked = [n for n in names if len(n) >= 2 and n in call]
        if not call or leaked or not GENDER_WORD.search(call):
            new = (c.get("look", "").split(",")[0].strip()[:12] + " " + word).strip()
            fixes.append(f"{p['id']} '{call}' → '{new}'" + (f"(이름 '{leaked[0]}')" if leaked else "(성별 낱말 없음)" if call else ""))
            call = new
        p["call"] = call
    return fixes


# ---------- 4) 상황 파악 ----------
# (가) 호칭 정하기 → 코드 검사(check_labels) → (나) 정해진 호칭으로 상황 흐름·목차·요약. 업로드 영상은 이름을 쓰지 않는다
# (2026-11-06 사용자: 인물을 못 맞추거나 이름을 지어내면 안 되니 성별+겉모습으로, 같은 사람은 같은 호칭으로)

CONTEXT = """영상 제목: "{title}"  (길이 {dur})
{guide}
사람 목록(번호는 {id_note}):
{people}

대사(시각, [말한 사람 · 목소리 성별 | 그때 화면에 보인 얼굴] 말). 말한 사람은 목소리·얼굴·흐름으로 정한 것입니다:
{dialogue}

화면에서 본 일(시각, [장소], 누가 → 누구에게, 무엇을):
{seen}

화면 글자:
{texts}
"""

LABELS_PROMPT = """당신은 시각장애인을 위한 화면해설 작가입니다. 해설에서 사람마다 부를 호칭을 정합니다.
이 영상은 이용자가 올린 영상이라 등장인물이 누구인지 확인할 수 없습니다. 틀린 이름은 시청자를 헷갈리게 하므로 이름은 쓰지 않습니다
(대사·제목·화면 글자에 이름이 나와도, 유명한 작품의 인물처럼 보여도).
{sheet_note}{context}
people — 번호마다
- call: 성별(남성·여성, 사람이 아니면 캐릭터) + 다른 사람과 가를 수 있는 겉모습 한두 가지, 12자 안팎.
  예: "갈색 코트 여성", "검은 정장 남성", "안경 쓴 중년 남성", "주황 갈기 캐릭터".
  화면에서 직업·역할이 분명하면 겉모습 대신 써도 됩니다(예: "흰 가운 의사", "식당 종업원 여성").
  사람마다 call이 달라야 하고, 영상 끝까지 이 호칭 하나로 부릅니다. 이름·별명·높임말을 넣지 않습니다.
- same_as: 얼굴 각도·조명 때문에 같은 사람이 두 번호로 나뉘었으면(겉모습·옷이 같고 같은 장면에 함께 나오지 않음) 앞 번호를
  적습니다. 다른 사람이면 빈 문자열.
모든 글은 한국어 한글입니다.
"""

STORY_PROMPT = """당신은 시각장애인을 위한 화면해설 작가입니다. 해설을 쓰기 전에 이 영상의 상황 흐름을 먼저 정확히 파악합니다.
사람마다 부를 호칭은 이미 정해 두었습니다(아래 호칭을 그대로 씁니다. 대사에 이름이 나와도 이름은 쓰지 않습니다):
{named}

{context}
할 일
1) situations — 영상 전체의 상황 흐름을 처음부터 끝까지 빈틈없이 나눕니다(앞 상황의 end = 다음 상황의 start, 마지막 end = {dur}).
   상황은 장소나 목적이 바뀌는 단위입니다. title은 25자 이내 한 줄, what에는 누가 누구에게 왜 무엇을 하는지 대사로 드러난 사정까지
   한두 문장. 대사의 말한 사람과 본 일을 맞춰 행동하는 사람과 받는 사람을 정확히 씁니다.
   몸의 일부(손·발)가 누구의 것인지는 본 일 기록이 틀릴 수 있습니다(얼굴 없이 발만 보이면 다음 장면 사람으로 착각함).
   다쳤다·아프다고 자기 일을 말한 사람이 그 몸의 주인입니다. 누가 누구를 위해 무엇을 부탁하는지도 대사 그대로 씁니다.
2) chapters — 시청자가 "○○ 장면으로 가 줘"라고 찾아갈 메인 장면 {lo}~{hi}개. 줄거리가 바뀌는 순간(인물 등장, 문제 발생, 갈등,
   해결, 결말). 첫 목차는 00:00. title은 사건 한 줄 25자 이내.
3) summary — 영상 전체를 2~3문장으로.
번호(P1)가 아니라 정해 둔 부르는 말로 씁니다. 모든 글은 한국어 한글입니다.
"""


async def understand(inf, title: str, duration_ms: int, look: dict, faces: dict, segs: list[dict], guide: str) -> dict:
    from app.pipeline.video import chapter_range, mmss
    lo, hi = chapter_range(duration_ms)
    counts = {p["id"]: p for p in faces["persons"]}
    people = []
    for pid, c in look["cast"].items():
        p = counts.get(pid)
        seen_at = f", 화면 {p['count'] / FACE_FPS:.0f}초({mmss(int(p['first'] * 1000))}~{mmss(int(p['last'] * 1000))})" if p else ""
        people.append(f"  {pid}: {c.get('gender', '')}·{c.get('age', '')}, {c.get('look', '')}{seen_at}")
    for pid, p in counts.items():
        if pid not in look["cast"]:
            people.append(f"  {pid}: (보기 단계에서 못 봄), 화면 {p['count'] / FACE_FPS:.0f}초")
    rows = address_rows(segs, faces)
    sheet = face_sheet(faces["persons"]) if faces["persons"] else None

    def context(calls: dict[str, str] | None) -> str:
        name = (lambda t: name_ids(t, calls)) if calls else (lambda t: t)  # noqa: E731
        who = lambda k: (calls.get(k, k) if calls and k else k)  # noqa: E731
        dialogue = [f"  {mmss(s['startMs'])} [{speaker_tag({**s, 'who': who(s.get('pid'))}, faces)}] {s['text']}" for s in segs]
        seen = [f"  {mmss(x['ms'])} [{x.get('place', '')}] {','.join(who(k) for k in x['who']) or '?'}"
                + (f" → {','.join(who(k) for k in x['to'])}" if x.get("to") else "") + f": {name(x['what'])}" for x in look["seen"]]
        texts = [f"  {mmss(t['ms'])} ({t['kind']}) {t['text']}" for t in look["screen_text"]]
        return CONTEXT.format(title=title, dur=mmss(duration_ms), guide=guide.strip(),
                              id_note="얼굴로 묶은 P와 보기 단계가 붙인 X" if faces["persons"] else "보기 단계가 겉모습으로 붙인 것",
                              people="\n".join(people) or "  (없음)", dialogue="\n".join(dialogue) or "  (없음)",
                              seen="\n".join(seen) or "  (없음)", texts="\n".join(texts) or "  (없음)")

    # (가) 호칭
    ident = {"type": "string", "pattern": ID_PATTERN}
    person = {"type": "object", "properties": {"id": ident, "same_as": {"type": "string", "pattern": "^([PXC][0-9]{1,2})?$"},
                                               "call": text_rule(16)},
              "required": ["id", "same_as", "call"], "additionalProperties": False}
    labels_prompt = LABELS_PROMPT.format(sheet_note="첫 사진은 얼굴로 묶은 사람들의 얼굴 모음입니다(왼쪽 위 번호 = 사람 번호).\n" if sheet else "",
                                         context=context(None))
    r = await inf.generate_json(labels_prompt, {"type": "object", "properties": {"people": {"type": "array", "items": person,
                                                                                       "minItems": 1, "maxItems": 14}},
                                          "required": ["people"], "additionalProperties": False},
                          max_tokens=1500, images=[sheet] if sheet else None)
    known = set(look["cast"]) | set(counts)
    found = [p for p in r["result"]["people"] if p["id"] in known]
    found += [{"id": k, "same_as": "", "call": ""} for k in known if k not in {p["id"] for p in found}]
    ids = {p["id"] for p in found}
    canon: dict[str, str] = {}
    for p in found:  # 같은 사람(same_as)은 앞 번호의 호칭을 쓴다
        main = p["same_as"] if p["same_as"] in ids and p["same_as"] != p["id"] else p["id"]
        canon[p["id"]] = canon.get(main, main)
    fixes = check_labels(found, look, rows, title)
    by_id = {p["id"]: p for p in found}
    for p in found:
        if canon[p["id"]] != p["id"]:
            p["call"] = by_id[canon[p["id"]]]["call"]
    dup = Counter(p["call"] for p in found if canon[p["id"]] == p["id"])
    for p in found:  # 같은 호칭이 둘이면 겉모습을 붙여 가른다
        if dup[p["call"]] > 1 and canon[p["id"]] == p["id"]:
            first = look["cast"].get(p["id"], {}).get("look", p["id"]).split(",")[0].strip()[:10]
            p["call"] = f"{p['call']}({first})"
    calls = {p["id"]: p["call"] for p in found}

    # (나) 상황 흐름·목차·요약
    named = "\n".join(f"  {p['id']} = {p['call']}" + (f" (같은 사람 {canon[p['id']]})" if canon[p["id"]] != p["id"] else "")
                      + f": {look['cast'].get(p['id'], {}).get('look', '')}" for p in found)
    situation = {"type": "object", "properties": {"start": MMSS, "end": MMSS, "place": text_rule(20), "title": text_rule(30),
                                                  "what": text_rule(150)},
                 "required": ["start", "end", "place", "title", "what"], "additionalProperties": False}
    chapter = {"type": "object", "properties": {"start": MMSS, "title": text_rule(30)}, "required": ["start", "title"],
               "additionalProperties": False}
    first = {**chapter, "properties": {**chapter["properties"], "start": {"const": "00:00"}}}
    schema = {"type": "object", "properties": {
        "situations": {"type": "array", "items": situation, "minItems": 1, "maxItems": max(3, duration_ms // 30_000)},
        "chapters": {"type": "array", "prefixItems": [first], "items": chapter, "minItems": lo, "maxItems": hi},
        "summary": text_rule(300)},
        "required": ["situations", "chapters", "summary"], "additionalProperties": False}
    story_prompt = STORY_PROMPT.format(named=named, context=context(calls), dur=mmss(duration_ms), lo=lo, hi=hi)
    r2 = await inf.generate_json(story_prompt, schema, max_tokens=5000)
    out = r2["result"]
    for x in out["situations"]:
        x["startMs"], x["endMs"] = to_ms(x["start"]), to_ms(x["end"])
    return {**out, "people": found, "canon": canon, "label_fixes": fixes, "prompt": labels_prompt + "\n\n=====\n\n" + story_prompt,
            "model": r2.get("model")}


def name_ids(text: str, calls: dict[str, str]) -> str:
    """글 속 번호(P1, X2, C1)를 호칭으로. 뒤 조사는 받침에 맞춘다. 모르는 번호는 '누군가'."""
    from app.pipeline.video import swap_name
    for pid in sorted(set(re.findall(ID, text)), key=len, reverse=True):
        text = swap_name(text, pid, calls.get(pid, "누군가"))
    return text


# ---------- 5) 해설 대본 ----------

SCRIPT_PROMPT = """당신은 시각장애인을 위한 화면해설 작가입니다. 상황 흐름과 화면에서 본 일을 바탕으로 이 구간({a}~{b})의 해설 대본을 씁니다.
시청자는 대사와 소리를 직접 듣습니다. 해설은 화면에서만 알 수 있는 것을 대사 사이 빈틈에 넣습니다.

영상 "{title}" 인물(해설에서 부르는 말: 겉모습):
{people}

영상 전체 상황 흐름:
{situations}

이 구간 대사([말한 사람]):
{dialogue}

이 구간의 빈틈(대사가 없는 시간):
{gaps}

이 구간에서 본 일(시각 [장소] 일):
{seen}

이 구간의 표정·옷차림·장소 모습:
{details}

해설 규칙
- 본 일과 표정·장소 목록에 있는 것만 씁니다. 누가 누구에게 하는지는 본 일 그대로(바꾸지 않음). 상황 흐름은 뜻을 이해하는 데 씁니다.
- 인물은 위 목록의 호칭으로만 부릅니다. 대사에 이름이 나와도 이름을 쓰지 않습니다. "그", "그녀", "그 남자" 같은 대명사와 "이어서", "또한"을 쓰지 않습니다.
- level 1: 줄거리를 따라가는 데 꼭 필요한 것(장소가 바뀜, 인물의 첫 등장, 핵심 행동과 결과, 중요한 화면 글자). level 1만 들어도 상황이 이어져야 합니다.
  level 2: 인물의 행동·표정·몸짓·위치. level 3: 옷차림·장소 모습·분위기. level 2·3은 level 1에 없는 새 정보만.
- 대사로 이미 말한 내용(이름·계획·감정·무엇을 하는지)을 되풀이하거나 "~라고 말한다", "대화를 나눈다"처럼 말한 사실을 전하지 않습니다.
- at은 그 일이 화면에 보이는 시각입니다. 그 시각에 대사가 이어지면 그 뒤 가장 가까운 빈틈 시작으로(4초 넘게 늦추지 않음).
- 한 문장에 한 가지, 현재형 평서문("~한다"). 마침표로 두 문장을 이어 쓰지 않습니다. level 1은 25자, level 2·3은 30자 이내.
- 쓰지 않는 표현: "~모습이 보인다", "화면에", "장면에서", "카메라가", "~것 같다", "~듯하다".
- 모든 글은 한국어 한글.
"""


SCRIPT_CHARS = {1: 32, 2: 36, 3: 36}  # 상세도별 해설 한 문장 글자 수 상한(지시는 25·30자, 조사·띄어쓰기 여유)


def split_sentences(text: str, calls: dict[str, str] | None = None) -> list[str]:
    """"A가 앉아 있다. B가 들어온다." → 두 문장. 따옴표 안 마침표는 나누지 않는다. 뒷문장에 인물 호칭이 없으면
    누구 이야기인지 모르는 조각("표정은 진지하다.", 2026-11-05)이라 버린다(호칭 목록을 줄 때만)."""
    parts = [x if x.endswith(".") else x + "." for x in (p.strip() for p in re.split(r"(?<=[다요])\.\s+(?=[^'\"’”])", text.strip())) if x]
    if calls and len(parts) > 1:
        names = [v for v in calls.values() if v]
        parts = parts[:1] + [x for x in parts[1:] if any(n in x for n in names)]
    return parts


def gaps_in(segs: list[dict], a: int, b: int) -> list[tuple[int, int]]:
    out, t = [], a
    for s in sorted((s for s in segs if s["endMs"] > a and s["startMs"] < b), key=lambda s: s["startMs"]):
        if s["startMs"] - t >= GAP_MIN_MS:
            out.append((t, s["startMs"]))
        t = max(t, s["endMs"])
    if b - t >= GAP_MIN_MS:
        out.append((t, b))
    return out


async def write_script(inf, title: str, duration_ms: int, sit: dict, look: dict, segs: list[dict], calls: dict[str, str],
                 on_done: OnDone = None) -> list[dict]:
    """2분씩 글만으로 해설 대본(20초 구간마다 상세도별 문장 수를 스키마로 강제). 돌려주는 것: [{at, level, text}]."""
    from app.pipeline.video import VIDEO_WINDOW_COUNTS, mmss
    people = "\n".join(f"  {p['call']}: {look['cast'].get(p['id'], {}).get('look', '')}" for p in sit["people"]) or "  (없음)"
    situations = "\n".join(f"  {s['start']}~{s['end']} [{s['place']}] {s['title']}: {s['what']}" for s in sit["situations"])
    spans = [(a, min(duration_ms, a + SCRIPT_CHUNK_MS)) for a in range(0, duration_ms, SCRIPT_CHUNK_MS)]
    if len(spans) > 1 and spans[-1][1] - spans[-1][0] < WINDOW_MS:  # 끝에 20초보다 짧은 조각은 앞에 붙인다
        spans[-2:] = [(spans[-2][0], spans[-1][1])]
    # 글자 수를 상세도별로 강제한다. 60자까지 허용했더니 두 문장을 이어 50자 넘게 써서(읽는 데 9초) 다음 문장 놓을 자리가 없어
    # 대본 24문장이 9문장으로 줄었다(2026-11-05 먼작귀)
    line = {k: {"type": "object", "properties": {"at": MMSS, "text": text_rule(SCRIPT_CHARS[k])}, "required": ["at", "text"],
                "additionalProperties": False} for k in SCRIPT_CHARS}

    async def one(span: tuple[int, int]) -> list[dict]:
        a, b = span
        dialogue = "\n".join(f"  {mmss(s['startMs'])}~{mmss(s['endMs'])} [{s.get('name') or '?'}] {s['text']}"
                             for s in segs if s["startMs"] < b and s["endMs"] > a) or "  (없음)"
        gaps = ", ".join(f"{mmss(x)}~{mmss(y)}" for x, y in gaps_in(segs, a, b)) or "(없음)"
        seen = "\n".join(f"  {mmss(x['ms'])} [{x.get('place', '')}] {name_ids(x['what'], calls)}"
                         for x in look["seen"] if a <= x["ms"] < b) or "  (없음)"
        details = "\n".join(f"  {mmss(x['ms'])} {name_ids(x['what'], calls)}" for x in look["details"] if a <= x["ms"] < b) or "  (없음)"
        prompt = SCRIPT_PROMPT.format(a=mmss(a), b=mmss(b), title=title, people=people, situations=situations,
                                      dialogue=dialogue, gaps=gaps, seen=seen, details=details)
        windows = []
        for s in range(a, b, WINDOW_MS):
            e = min(b, s + WINDOW_MS)
            props = {"from": {"const": mmss(s)}, "to": {"const": mmss(e)}}
            for level, (lo, hi) in VIDEO_WINDOW_COUNTS.items():
                props[f"lines_{level}"] = {"type": "array", "items": line[level], "minItems": lo, "maxItems": hi}
            windows.append({"type": "object", "properties": props, "required": list(props), "additionalProperties": False})
        schema = {"type": "object", "properties": {"windows": {"type": "array", "prefixItems": windows, "items": False,
                                                               "minItems": len(windows), "maxItems": len(windows)}},
                  "required": ["windows"], "additionalProperties": False}
        r = await inf.generate_json(prompt, schema, max_tokens=4000)
        out = []
        for w in r["result"]["windows"]:
            lo, hi = to_ms(w["from"]), max(to_ms(w["from"]), to_ms(w["to"]) - 1000)
            for level in VIDEO_WINDOW_COUNTS:
                for x in w.get(f"lines_{level}", []):
                    for sentence in split_sentences(name_ids(x["text"], calls), calls):  # 두 문장을 이어 쓰면 나눠서 따로 자리를 잡게
                        if not re.search(r"[다요]\.$", sentence):  # 글자 수 상한에 걸려 잘린 문장("서 있.")은 버린다
                            continue
                        out.append({"at": mmss(min(max(to_ms(x["at"]), lo), hi)), "level": level,
                                    "text": fix_injury_text(sentence, calls, look.get("injury_owner", {}))})
        return out

    ticker = Ticker(len(spans), on_done)

    gate = asyncio.Semaphore(3)

    async def counted(span):
        try:
            try:
                async with gate:
                    return await one(span)
            except inference.InferenceError:
                # 32B가 가끔 출력 한도까지 같은 말·공백을 써서 JSON이 끊긴다(2분 조각, 2026-11-05). 1분씩 나눠 한 번 더, 그래도 안 되면 그 조각은 비운다
                a, b = span
                mid = a + max(WINDOW_MS, (b - a) // 2 // WINDOW_MS * WINDOW_MS)
                out = []
                for half in ((a, mid), (mid, b)) if mid < b else ((a, b),):
                    try:
                        async with gate:
                            out += await one(half)
                    except inference.InferenceError:
                        pass
                return out
        finally:
            await ticker.tick()
    return [x for part in await asyncio.gather(*(counted(sp) for sp in spans)) for x in part]


# ---------- 화면 글자 정리 ----------
LOGO_MIN = 3  # 이만큼 넘게 다시 적힌 글자 묶음은 계속 떠 있는 로고·방송 시간으로 본다
LOGO_COMMON = 6  # 두 글자가 이만큼 넘게 이어서 같으면 같은 로고의 다른 꼴로 본다


def _key(text: str) -> str:
    return re.sub(r"[^가-힣A-Za-z0-9]", "", text or "")


def _same_logo(a: str, b: str) -> bool:
    if not a or not b:
        return False
    if (len(a) >= 3 and a in b) or (len(b) >= 3 and b in a):
        return True
    short, long_ = sorted((a, b), key=len)
    return any(short[i:i + LOGO_COMMON] in long_ for i in range(len(short) - LOGO_COMMON + 1))


def clean_screen_texts(look: dict, segs: list[dict], duration_ms: int) -> list[str]:
    """보기 단계 화면 글자 정리(옛 방식의 dedupe_screen_texts·mark_dialogue_subtitles를 상황 먼저에도).
    1) 계속 떠 있는 로고·방송 시간: 조각마다 꼴을 바꿔 다시 적었다("100일의 거짓말 [토일 밤 9:10]", "(토일 밤 9:10)",
       "tvN" 따로 …, 2026-11-06 7번 모두 중요도 상이라 7번 읽음). 글자만 남겨 서로 겹치는 것끼리 묶고, 영상 4분의 1 넘게 걸쳐
       여러 번 나오면 처음 한 번만 중요도 하(읽지 않음)로 남긴다
    2) 대사를 그대로 받아 적은 자막은 이미 들리므로 대사와 같음·중요도 하. 돌려주는 것: 정리 기록."""
    from app.pipeline.video import restates
    texts = look["screen_text"]
    keys = [_key(t["text"]) for t in texts]
    drop, notes = set(), []
    for i, k in enumerate(keys):
        if i in drop or not k:
            continue
        group = [j for j, k2 in enumerate(keys) if j not in drop and _same_logo(k, k2)]
        times = [texts[j]["ms"] for j in group]
        if len(group) >= LOGO_MIN and max(times) - min(times) >= duration_ms / 4:
            first = min(group, key=lambda j: texts[j]["ms"])
            texts[first]["low"] = True
            drop |= {j for j in group if j != first}
            notes.append(f"계속 떠 있는 글자 '{texts[first]['text']}' {len(group)}번 → 한 번(읽지 않음)")
    said = " ".join(x["text"] for x in segs)
    said_key = _key(said)
    for j, t in enumerate(texts):
        k = _key(t["text"])
        if j in drop or not said or not k:
            continue
        # "네"처럼 아주 짧은 자막은 대사에 그 말이 있으면 같은 것으로
        if (len(k) <= 2 and k in said_key) or (len(k) > 2 and restates(t["text"], said) >= 0.8):
            t["same"] = True
    look["screen_text"] = [t for j, t in enumerate(texts) if j not in drop]
    return notes


# ---------- 저장 형식으로 ----------

KIND_TYPE = {"제목": ("TITLE", "상"), "이름표": ("NAME_TAG", "상"), "자막": ("SUBTITLE", "중"), "간판": ("OTHER", "중"),
             "기타": ("OTHER", "하")}


def to_narration(sit: dict, look: dict, faces: dict, calls: dict[str, str], duration_ms: int) -> dict:
    """상황 → 장면(scenes), 사람 → 인물(people). 해설(lines)·대사(dialogue)는 video.analyze_situation에서 채운다."""
    from app.pipeline.video import mmss
    people_by_id = {p["id"]: p for p in sit["people"]}
    sits = sorted(sit["situations"], key=lambda s: s["startMs"])
    if sits:  # 처음과 끝을 덮게
        sits[0]["startMs"], sits[-1]["endMs"] = 0, duration_ms
    scenes = []
    for i, s in enumerate(sits):
        a = s["startMs"]
        b = sits[i + 1]["startMs"] if i + 1 < len(sits) else duration_ms
        if b <= a:
            continue
        ids = set(on_screen(faces, a, b)) if faces["persons"] else set()
        ids |= {w for x in look["seen"] if a <= x["ms"] < b for w in x["who"] + x.get("to", [])}
        ids = {sit["canon"].get(k, k) for k in ids}
        people = []
        for pid in sorted(ids, key=lambda k: list(people_by_id).index(k) if k in people_by_id else 99):
            p = people_by_id.get(pid)
            if not p:
                continue
            c = look["cast"].get(pid, {})
            gender = {"남": "남성", "여": "여성"}.get(c.get("gender"), "")
            people.append({"name": calls.get(pid) or p["call"], "basis": "겉모습 호칭",
                           "appearance": ", ".join(x for x in (gender, c.get("look", "")) if x)})
        texts = [{"text": t["text"], "text_type": KIND_TYPE[t["kind"]][0],
                  "importance": "하" if t.get("low") or t.get("same") else KIND_TYPE[t["kind"]][1],
                  "same_as_dialogue": bool(t.get("same"))} for t in look["screen_text"] if a <= t["ms"] < b][:3]
        scenes.append({"start": mmss(a), "end": mmss(b), "title": s["title"], "people": people, "screen_text": texts})
    return {"category": look["category"], "summary_30s": sit["summary"], "scenes": scenes, "label_names": True,
            "chapters": [{"start": c["start"], "title": c["title"]} for c in sit["chapters"]]}
