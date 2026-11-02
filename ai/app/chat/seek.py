"""말로 장면 찾기(/internal/chat/seek): 목차 키워드·제목·요약에서 먼저 찾고(크레딧 0), 못 찾으면 gemini-3.8-flash가 목차를 보고 고른다.

데모 backend/app/chat/seek.py를 옮겼다. words·by_keywords·spoken_ms·far_scene_hint는 순수 함수(시험 있음),
chapters_of는 asyncpg, by_ai는 팀 GmsClient(비동기).
"""
import re

from google.genai import types

SEEK_MODEL = "gemini-3.8-flash"
STOP = {"장면", "장면으로", "장면을", "장면이", "부분", "부분으로", "곳", "곳으로", "때", "때로", "쯤", "으로", "로", "가", "줘", "가줘",
        "가자", "이동", "이동해", "이동해줘", "보여", "보여줘", "찾아", "찾아줘", "틀어", "틀어줘", "나오는", "나온", "나왔던", "하는",
        "있는", "좀", "거기", "그", "다시", "데로", "데", "어디", "어디야", "넘겨", "넘겨줘", "같이", "된", "해줘", "해", "줘요"}
JOSA3 = re.compile(r"(으로|에서|이랑|로|이|가|을|를|은|는|의|에|와|과|도|만|랑)$")
JOSA2 = re.compile(r"(을|를|은|는|이|가|의)$")


def _stem(w: str) -> str:
    if len(w) >= 3:
        return JOSA3.sub("", w)
    if len(w) == 2:
        return JOSA2.sub("", w) or w
    return w


def words(q: str) -> list[str]:
    ws = [w for w in re.sub(r"[^0-9a-zA-Z가-힣\s]", " ", q.lower()).split() if w not in STOP]
    return [s for s in (_stem(w) for w in ws) if s and s not in STOP]


def by_keywords(query: str, chapters: list[dict]) -> list[dict]:
    """점수 높은 순 후보(최대 3개). 제목·키워드에 있으면 3점, 요약에 있으면 1점, 모든 낱말이 맞으면 +2."""
    ws = words(query)
    if not ws:
        return []
    out = []
    for c in chapters:
        head = (c["title"] + " " + " ".join(c["keywords"])).lower()
        body = (c["summary"] or "").lower()
        # 띄어쓰기 차이("엔딩크레딧" ↔ "엔딩 크레딧")도 맞게 공백 없는 본문과도 비교한다
        head_ns, body_ns = head.replace(" ", ""), body.replace(" ", "")
        score, hit = 0, []
        for w in ws:
            if w in head or w in head_ns:
                score, hit = score + 3, hit + [w]
            elif w in body or w in body_ns:
                score, hit = score + 1, hit + [w]
        if score:
            out.append({**c, "score": score + (2 if len(hit) == len(ws) else 0), "hit": hit})
    return sorted(out, key=lambda x: (-x["score"], x["startMs"]))[:3]


def pick(candidates: list[dict]) -> dict | None:
    """후보가 하나뿐이거나 1등이 2등의 두 배 이상이면 바로 고른다. 아니면 None(AI에게 묻거나 FE가 후보를 읽어 준다)."""
    if candidates and (len(candidates) == 1 or candidates[0]["score"] >= candidates[1]["score"] * 2):
        return candidates[0]
    return None


async def by_ai(gms, query: str, chapters: list[dict], chat_log_id: int | None = None, limit: int = 3) -> list[dict]:
    """목차 제목·요약·키워드를 보고 요청과 맞는 장면을 0~limit개, 잘 맞는 순서로 고른다(명세 3번, gemini-3.8-flash)."""
    from app.gms.client import CallContext

    toc = "\n".join(f"{i + 1}. {c['title']} / {c['summary'] or ''} / {', '.join(c.get('keywords') or [])}"
                    for i, c in enumerate(chapters))
    cfg = types.GenerateContentConfig(temperature=0, thinking_config=types.ThinkingConfig(thinking_budget=0),
                                      system_instruction="장면 목차를 보고 사용자의 요청과 맞는 장면 번호를 잘 맞는 순서로 "
                                                         f"최대 {limit}개 고르세요. 반드시 JSON 한 줄: {{\"n\": [번호, ...]}} "
                                                         "맞는 장면이 없으면 {\"n\": []}")
    r = await gms.generate(SEEK_MODEL, f"[장면 목차]\n{toc}\n\n사용자 요청: {query}", cfg,
                           CallContext("INTENT", chat_log_id=chat_log_id))
    m = re.search(r'"n"\s*:\s*\[([\d,\s]*)\]', r.text or "")
    picked: list[dict] = []
    for n in (int(x) for x in re.findall(r"\d+", m.group(1))) if m else []:
        if 0 < n <= len(chapters) and chapters[n - 1] not in picked:
            picked.append(chapters[n - 1])
    return picked[:limit]


async def chapters_of(pool, description_id: int) -> list[dict]:
    rows = await pool.fetch("SELECT id, start_ms, end_ms, title, summary, keywords FROM chapters WHERE description_id = $1"
                            " ORDER BY chapter_index", description_id)
    return [{"chapterId": r["id"], "startMs": r["start_ms"], "endMs": r["end_ms"], "title": r["title"],
             "summary": r["summary"], "keywords": list(r["keywords"] or [])} for r in rows]


def spoken_ms(ms: int) -> str:
    """음성용 시각: 200000 → "3분 20초", 40000 → "40초" """
    s = max(0, round(ms / 1000))
    m, r = divmod(s, 60)
    if m == 0:
        return f"{r}초"
    return f"{m}분" if r == 0 else f"{m}분 {r}초"


def far_scene_hint(utterance: str, chapters: list[dict], now_ms: int) -> str | None:
    """답이 '자료에 없어요'일 때: 질문 낱말이 지금 장면이 아닌 다른 장면 목차에 있으면 그 장면으로 가서 물어보라고 안내한다.
    질문 답변 자료는 지금 시각 근처 장면만 담기 때문."""
    for c in by_keywords(utterance, chapters):
        if not (c["startMs"] <= now_ms < c["endMs"]):  # 지금 장면은 제외
            return f"{spoken_ms(c['startMs'])} '{c['title']}' 장면에 관련 내용이 있을 수 있어요. 그 장면으로 가서 물어보세요."
    return None
