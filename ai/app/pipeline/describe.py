"""job.describe — 조각별 배치·검증 (워커 메시지 명세 5장, AI 화면해설 파이프라인 명세서 2.2).

GEMINI_URL·LOCAL 모두: AI를 다시 부르지 않는다(크레딧 0). job.prepare가 저장한 full.json에서 이 조각 구간을 읽어
(LOCAL은 prepare가 H200으로 영상을 분석해 유튜브와 같은 full.json을 만든다 — pipeline/local.py)
- 누적형 해설 문장마다 startMs·gapEndMs를 정하고 (대사 중간이면 대사가 끝난 직후로 옮김)
- 대사 반복·긴 문장·앞 문장을 가리키는 말을 표시해 로그로 남기고 (다시 쓰게 하지 않음)
- 외국어 대사는 한국어 번역을 그 대사 시각에 읽어 줄 문장으로 넣고 (dub_lines)
- 해설 문장에 이미 들어간 화면 글자를 뺀 뒤
jobs/{jobId}/chunks/{chunkIndex}.json에 저장한다.
"""
import logging
import re
from difflib import SequenceMatcher

from app.errors import WorkerError
from app.mq.envelope import Envelope
from app.mq.worker import Events
from app.storage import Storage

log = logging.getLogger(__name__)

MAX_CHARS = 60
MIN_GAP_MS = 500  # 이보다 짧은 틈은 빈 구간이 없는 것으로 본다(gapEndMs = null)
REPEAT_WINDOW_MS = 10_000  # 해설 앞뒤 10초 안의 대사와 비교
REPEAT_RATIO = 0.6
REFERS_BACK = ("그는", "그녀", "그의", "그가", "그들", "그리고", "그러자", "그때", "이어서", "이어 ", "또한", "그 ")
# 프롬프트 v4 마지막 점검을 코드로도(2026-11-03): 쓰지 않는 표현, 대명사, 상세도별 글자 수(공백 포함, 모델이 조금 넘기는 건 흔해서 5자 여유)
BANNED_PHRASES = ("모습이 보", "이 보입니다", "가 보입니다", "화면에", "장면에서", "카메라가", "것 같", "듯하")
PRONOUNS = ("그녀", "그 남자", "그 여자", "그들")
LEVEL_MAX_CHARS = {1: 25, 2: 30, 3: 30}
NAME_SOURCE_HINTS = (("SCREEN_TEXT", ("자막", "제목", "이름표", "화면")), ("DIALOGUE", ("대사", "부름", "호명", "말")))


def _norm(s: str) -> str:
    return re.sub(r"[\s\W_]+", "", s)


MAX_SHIFT_MS = 6_000  # 대사를 피해 뒤로 미는 최대 거리. 내레이션이 쉬지 않는 영상(요리 강좌 등)에서 해설이 끝으로 몰리지 않게


def place(at_ms: int, dialogues: list[dict], duration_ms: int) -> tuple[int, int | None]:
    """대사 중간이면 대사가 끝난 직후로 옮긴다. 대사가 이어져 MAX_SHIFT_MS 넘게 밀려야 하면, 처음 만난 대사 끝(말이
    끊기는 자리)에 두고 gapEndMs는 null(빈틈 없음 → 재생 엔진이 영상을 잠깐 멈추고 읽는다).
    데모 검증(2026-10-29): 영어 내레이션 요리 영상에서 115문장이 모두 영상 끝(124초)으로 밀린 문제.
    처음 만난 대사 끝마저 MAX_SHIFT_MS보다 멀면(노래 한 절이 대사 하나로 잡힘) 원래 시각에 둔다. 데모 검증(2026-11-02):
    노래 영상에서 0:08~0:38 해설이 모두 1:15(1절 끝)로, 1:39~2:38 해설이 3:02로 몰린 문제."""
    t = at_ms
    first_end = None
    moved = True
    while moved:
        moved = False
        for d in dialogues:
            if d["startMs"] <= t < d["endMs"]:
                first_end = first_end if first_end is not None else d["endMs"]
                t, moved = d["endMs"], True
        if t - at_ms > MAX_SHIFT_MS:
            t = first_end if first_end - at_ms <= MAX_SHIFT_MS else at_ms
            break
    t = min(t, duration_ms)
    return t, gap_end(t, dialogues, duration_ms)


def gap_end(t: int, dialogues: list[dict], duration_ms: int) -> int | None:
    """t에서 시작하는 빈 구간의 끝(다음 대사 시작 또는 영상 끝). 대사 중이거나 틈이 MIN_GAP_MS보다 짧으면 None."""
    if any(d["startMs"] <= t < d["endMs"] for d in dialogues):  # 바로 다음 대사가 이어짐 → 빈틈 없음
        return None
    nxt = min((d["startMs"] for d in dialogues if d["startMs"] > t), default=duration_ms)
    return nxt if nxt - t >= MIN_GAP_MS else None


READ_MS_PER_CHAR, READ_MIN_MS, READ_REST_MS = 180, 800, 500  # 읽는 시간 어림(FE estimateSpeechMs와 같음) + 숨
FITS_SLACK_MS = 300  # 재생 엔진(FE useNarration)은 음성이 빈 구간 + 0.3초보다 길면 영상을 멈추고 읽는다
PAUSED_STEP_MS = 1000  # 멈추고 읽는 문장 다음 문장과의 간격(영상 시각). 같은 시각이면 재생 엔진이 한 번에 겹쳐 받는다
TAIL_MS = 1000  # 밀린 문장도 영상 끝 1초 전에는 시작하게(끝 시각에 두면 영상이 끝나 읽히지 않는다)


DUB_FLAG = "DIALOGUE_DUB"  # 외국어 대사를 한국어로 읽어 주는 문장 표시(해설 문장이 아님)
SENTENCE_END = re.compile(r"(?<=[.!?…])\s+")


def dub_lines(dialogues: list[dict]) -> list[dict]:
    """외국어 대사(dub 표시, text는 한국어 번역)를 그 대사 시각에 읽어 줄 문장으로 만든다. dialogues는 시각 순.
    2026-11-10 '100일의 거짓말': 일본어·영어 연설을 알아들을 수 없었다(넷플릭스 화면해설은 성우가 한국어로 읽는다).
    - 상세도 1(내용을 따라가는 데 꼭 필요), gapEndMs null: 대사와 겹치므로 재생 엔진이 영상을 멈추고 읽은 뒤 원래 말을 들려준다.
    - 말한 사람이 바뀔 때만 "태웅: …"처럼 이름을 붙인다(한국어 대사가 끼면 다시 붙인다).
    - MAX_CHARS를 넘는 번역은 문장 단위로 나누고, 시각은 대사 길이에 글자 수 비율로 나눠 준다."""
    out, prev = [], None
    for d in dialogues:
        if not d.get("dub"):
            prev = None
            continue
        speaker = (d.get("speaker") or "").split(" (")[0].strip() or None
        parts: list[str] = []
        for s in SENTENCE_END.split(d["text"].strip()):
            if parts and len(parts[-1]) + 1 + len(s) <= MAX_CHARS:
                parts[-1] += " " + s
            elif s:
                parts.append(s)
        total, done = sum(len(p) for p in parts) or 1, 0
        for i, p in enumerate(parts):
            start = d["startMs"] + (d["endMs"] - d["startMs"]) * done // total
            done += len(p)
            text = f"{speaker}: {p}" if i == 0 and speaker and speaker != prev else p
            out.append({"detailLevel": 1, "startMs": start, "gapEndMs": None, "importance": 3, "text": text, "flags": [DUB_FLAG]})
        prev = speaker
    return out


NEAR_MS = 1500  # 시작이 이 안에 붙은 같은 상세도 문장은 따로 읽지 않고 두 문장짜리 해설 하나로 묶는다


def join_near(lines: list[dict]) -> list[dict]:
    """1초쯤 간격으로 붙은 같은 상세도 문장 둘을 앞 문장 시각의 해설 하나("문장1 문장2")로 묶는다. lines는 시각 순.
    따로 두면 앞 문장을 읽는 중에 뒤 문장이 와서 영상을 거듭 멈추게 된다(2026-11-10 사용자 결정: 차라리 두 줄로).
    상세도가 다르면 묶지 않는다(상세도는 누적이라 묶으면 낮은 상세도에서 들리는 내용이 달라진다) → spread가 띄운다.
    두 문장까지만, 합쳐서 MAX_CHARS를 넘으면 묶지 않는다."""
    out: list[dict] = []
    joined: set[int] = set()
    for x in lines:
        if DUB_FLAG in (x.get("flags") or []):  # 읽어 주는 대사는 해설 문장과 섞지 않는다
            out.append(x)
            continue
        prev = next((p for p in reversed(out) if p["detailLevel"] == x["detailLevel"]), None)
        if (prev is not None and id(prev) not in joined and DUB_FLAG not in (prev.get("flags") or [])
                and x["startMs"] - prev["startMs"] <= NEAR_MS
                and len(prev["text"]) + 1 + len(x["text"]) <= MAX_CHARS):
            prev["text"] += " " + x["text"]
            prev["flags"] = list(dict.fromkeys(list(prev.get("flags") or []) + list(x.get("flags") or [])))
            joined.add(id(prev))
            continue
        out.append(x)
    return out


def spread(lines: list[dict], dialogues: list[dict], duration_ms: int) -> list[dict]:
    """앞 문장을 다 읽기 전에 시작하는 문장을 그 뒤로 민다. lines는 시각 순, 제자리에서 고친다(상세도 3까지 다 듣는 경우 기준).
    2026-11-10 박진영 직캠: 해설이 0·1·2·3초, 2:00에 두 문장처럼 몰려 재생 엔진이 뒤 문장을 버렸다(문장 하나 읽는 데 2.5~3초).
    영상과 함께 읽을 수 있는 문장(빈 구간에 들어감) 뒤에는 읽는 시간만큼, 멈추고 읽는 문장 뒤에는 PAUSED_STEP_MS만 띄운다
    (멈춘 동안은 영상 시각이 흐르지 않는다). 밀린 문장의 gapEndMs는 새 시각으로 다시 구한다."""
    free = 0
    for x in lines:
        start = max(x["startMs"], min(free, max(0, duration_ms - TAIL_MS)))
        if start != x["startMs"]:
            # 밀린 시각이 대사 한가운데면 place처럼 대사 끝으로 다시 옮긴다(MAX_SHIFT_MS 안에서). 안 그러면 대사가 시작되고
            # 곧 영상이 멈추고 해설이 끼어든다(2026-11-10 점검: 2~8초 대사 사이 1.8초 문장이 2.5초로 밀림)
            if any(d["startMs"] <= start < d["endMs"] for d in dialogues):
                start = min(place(start, dialogues, duration_ms)[0], max(start, duration_ms - TAIL_MS))
            x["startMs"], x["gapEndMs"] = start, gap_end(start, dialogues, duration_ms)
        need = max(READ_MIN_MS, len(x["text"]) * READ_MS_PER_CHAR)
        fits = x["gapEndMs"] is not None and need <= x["gapEndMs"] - start + FITS_SLACK_MS
        free = start + (need + READ_REST_MS if fits else PAUSED_STEP_MS)
    return lines


def check(text: str, start_ms: int, dialogues: list[dict], level: int | None = None) -> list[str]:
    flags = []
    if len(text) > MAX_CHARS:
        flags.append("TOO_LONG")
    elif level in LEVEL_MAX_CHARS and len(text) > LEVEL_MAX_CHARS[level] + 5:
        flags.append("OVER_LEVEL_LENGTH")
    if text.startswith(REFERS_BACK):
        flags.append("REFERS_BACK")
    if any(p in text for p in BANNED_PHRASES):
        flags.append("BANNED_PHRASE")
    if any(p in text for p in PRONOUNS):
        flags.append("PRONOUN")
    n = _norm(text)
    for d in dialogues:
        if abs(d["startMs"] - start_ms) > REPEAT_WINDOW_MS:
            continue
        dn = _norm(d["text"])
        if dn and (SequenceMatcher(None, n, dn).ratio() >= REPEAT_RATIO or (len(dn) >= 8 and dn in n)):
            flags.append("REPEATS_DIALOGUE")
            break
    return flags


def _name_source(basis: str | None) -> str | None:
    if not basis:
        return None
    for code, hints in NAME_SOURCE_HINTS:
        if any(h in basis for h in hints):
            return code
    return "AI"


def build_chunk(full: dict, chunk_index: int, start_ms: int, end_ms: int) -> dict:
    duration = full["durationMs"]
    last = end_ms >= duration
    in_chunk = (lambda t: start_ms <= t <= end_ms) if last else (lambda t: start_ms <= t < end_ms)
    dialogues = full["dialogues"]  # 배치는 영상 전체 대사로 본다(빈 구간이 다음 조각까지 이어질 수 있음)

    lines = []
    for x in full["lines"]:
        if not in_chunk(x["atMs"]):
            continue
        start, gap_end = place(x["atMs"], dialogues, duration)
        lines.append({"detailLevel": x["detailLevel"], "startMs": start, "gapEndMs": gap_end,
                      "importance": 4 - x["detailLevel"], "text": x["text"],
                      "flags": check(x["text"], start, dialogues, x["detailLevel"])})
    lines += [x for x in dub_lines(dialogues) if in_chunk(x["startMs"])]  # 외국어 대사는 한국어로 읽어 준다
    lines.sort(key=lambda x: (x["startMs"], x["detailLevel"]))

    scenes, screen_texts, characters, seen = [], [], [], set()
    line_norms = [_norm(x["text"]) for x in lines]
    for s in full["scenes"]:
        if s["endMs"] <= start_ms or (s["startMs"] >= end_ms and not (last and s["startMs"] == end_ms)):
            continue
        a, b = max(s["startMs"], start_ms), min(s["endMs"], end_ms)
        desc = " ".join(x["text"] for x in lines if a <= x["startMs"] < b or (x["startMs"] == b == end_ms))
        scenes.append({"startMs": a, "endMs": b, "title": s["title"], "sceneDescription": desc or None,
                       "keyframeKey": None})
        for p in s["people"]:
            key = p["name"] or p["appearance"]
            if key in seen:
                continue
            seen.add(key)
            characters.append({"label": p["name"] or f"인물{len(characters) + 1}", "name": p["name"], "aliases": [],
                               "appearance": p["appearance"], "nameSource": _name_source(p["basis"]) if p["name"] else None})
        if not in_chunk(s["startMs"]):  # 화면 글자는 장면이 시작한 조각에만 넣어 겹치지 않게 한다
            continue
        for t in s["screenTexts"]:
            tn = _norm(t["text"])
            if len(tn) >= 2 and any(tn in ln for ln in line_norms):
                continue  # 해설 문장에 이미 들어간 화면 글자
            screen_texts.append({"startMs": s["startMs"], "endMs": s["endMs"], "textType": t["textType"],
                                 "importance": t["importance"], "headline": None, "fullText": t["text"],
                                 "summaryText": None, "sameAsDialogue": t["sameAsDialogue"], "characterLabel": None})

    chunk_dialogues = [d for d in dialogues if in_chunk(d["startMs"])]
    return {"chunkIndex": chunk_index, "lines": lines, "scenes": scenes, "screenTexts": screen_texts,
            "dialogues": chunk_dialogues, "characters": characters}


class Describe:
    def __init__(self, storage: Storage):
        self.storage = storage

    async def __call__(self, env: Envelope, events: Events) -> None:
        p, job_id = env.payload, env.jobId
        idx = int(p["chunkIndex"])
        key = f"jobs/{job_id}/chunks/{idx}.json"
        if await self.storage.exists(key):  # 중복 메시지
            await events.chunk_succeeded(idx, {"resultKey": key})
            return
        if p.get("pipeline") not in ("GEMINI_URL", "LOCAL"):
            raise WorkerError("UNKNOWN", f"아직 지원하지 않는 pipeline: {p.get('pipeline')}", retryable=False)

        full_key = f"jobs/{job_id}/full.json"
        if not await self.storage.exists(full_key):
            raise WorkerError("UNKNOWN", f"{full_key}가 없습니다(job.prepare 결과 없음)")
        await events.started()
        chunk = build_chunk(await self.storage.get_json(full_key), idx, int(p["startMs"]), int(p["endMs"]))
        flagged = [x for x in chunk["lines"] if x["flags"]]
        for x in flagged:
            log.info("검증 표시 job=%s chunk=%s %s [%s] %s", job_id, idx, x["flags"], x["startMs"], x["text"])
        await self.storage.put_json(key, chunk)
        log.info("describe 완료 job=%s chunk=%s 문장 %s개(표시 %s개), gapEndMs 없음 %s개", job_id, idx,
                 len(chunk["lines"]), len(flagged), sum(1 for x in chunk["lines"] if x["gapEndMs"] is None))
        await events.chunk_succeeded(idx, {"resultKey": key})
