"""job.describe — 조각별 배치·검증 (워커 메시지 명세 5장, AI 화면해설 파이프라인 명세서 2.2).

GEMINI_URL: Gemini를 다시 부르지 않는다(크레딧 0). job.prepare가 저장한 full.json에서 이 조각 구간을 읽어
- 누적형 해설 문장마다 startMs·gapEndMs를 정하고 (대사 중간이면 대사가 끝난 직후로 옮김)
- 대사 반복·긴 문장·앞 문장을 가리키는 말을 표시해 로그로 남기고 (다시 쓰게 하지 않음)
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
NAME_SOURCE_HINTS = (("SCREEN_TEXT", ("자막", "제목", "이름표", "화면")), ("DIALOGUE", ("대사", "부름", "호명", "말")))


def _norm(s: str) -> str:
    return re.sub(r"[\s\W_]+", "", s)


def place(at_ms: int, dialogues: list[dict], duration_ms: int) -> tuple[int, int | None]:
    """읽기 시작 시각과 그 뒤 처음 시작하는 대사의 시작(gapEndMs)."""
    t = at_ms
    moved = True
    while moved:  # 대사 중간이면 끝난 직후로. 옮긴 곳이 또 다른 대사 중간이면 한 번 더
        moved = False
        for d in dialogues:
            if d["startMs"] <= t < d["endMs"]:
                t, moved = d["endMs"], True
    t = min(t, duration_ms)
    nxt = min((d["startMs"] for d in dialogues if d["startMs"] > t), default=duration_ms)
    return t, (nxt if nxt - t >= MIN_GAP_MS else None)


def check(text: str, start_ms: int, dialogues: list[dict]) -> list[str]:
    flags = []
    if len(text) > MAX_CHARS:
        flags.append("TOO_LONG")
    if text.startswith(REFERS_BACK):
        flags.append("REFERS_BACK")
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
                      "flags": check(x["text"], start, dialogues)})
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
        if p.get("pipeline") != "GEMINI_URL":
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
