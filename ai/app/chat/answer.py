"""질문 답변(/internal/chat/answer) — ai_pipeline_spec 3.3.

자료(화면 캡처 없음): 지금 장면과 앞 장면(제목·장면 설명), 질문 시각 **앞 60초 대사만**(뒤 대사는 스포일러),
그 장면들의 화면 글자, 30초 요약, 등장인물. gemini-3.1-flash-lite로 1~2문장. 자료에 없으면 "그건 해설 자료에 없어요".
SCENE_NOW(지금 장면 설명)와 등장인물 겉모습 질문은 AI를 부르지 않고 저장된 자료로 답한다.

데모 backend/app/chat/answer.py를 옮겼다. split_sentences·character_answer·scene_now는 순수 함수(시험 있음),
context는 asyncpg, answer_sentences는 팀 GmsClient(비동기). 팀 GmsClient에 스트리밍(generate_content_stream)이 없어
우선 한 번에 받아 문장으로 나눈다(답이 200토큰 이하라 1초 안팎). stream()을 붙이면 문장이 완성되는 대로 낼 수 있다(README).
"""
import json
import re
from collections.abc import AsyncIterator

from google.genai import types

ANSWER_MODEL = "gemini-3.1-flash-lite"
UNANSWERABLE = "그건 해설 자료에 없어요"
SYSTEM = ("당신은 시각장애인이 영상을 보다가 한 질문에 답하는 도우미입니다. 아래 '해설 자료'(현재 시각 근처의 장면·대사)만 근거로 "
          "한국어로 1~2문장, 짧게 말하듯 답하세요. 자료에 없는 내용은 지어내지 말고 '" + UNANSWERABLE + "'라고 답하세요. "
          "사람이나 캐릭터 이름은 자료에 이름이 있을 때만 말하세요. 시각 숫자나 MM:SS는 읽지 마세요.")
SENTENCE = re.compile(r"^(.+?[.?!。])(\s|$)", re.S)
RECENT_DIALOGUE_MS = 60_000


def mmss(ms: int) -> str:
    return f"{ms // 60000:02d}:{ms // 1000 % 60:02d}"


async def context(pool, description_id: int, t_ms: int) -> dict:
    """답변 자료. 키 이름은 그대로 프롬프트에 들어가므로 한국어."""
    d = await pool.fetchrow("SELECT summary_text FROM descriptions WHERE id = $1", description_id)
    scenes = await pool.fetch("SELECT start_ms, title, scene_description FROM scenes WHERE description_id = $1 AND start_ms <= $2"
                              " ORDER BY start_ms DESC LIMIT 2", description_id, t_ms)
    scenes = list(scenes)[::-1]
    if not scenes:
        scenes = list(await pool.fetch("SELECT start_ms, title, scene_description FROM scenes WHERE description_id = $1"
                                       " ORDER BY start_ms LIMIT 1", description_id))
    lo = scenes[0]["start_ms"] if scenes else 0
    dia = await pool.fetch("SELECT t.start_ms, c.name AS speaker, t.text FROM transcript_segments t LEFT JOIN characters c"
                           " ON c.id = t.character_id WHERE t.description_id = $1 AND t.start_ms BETWEEN $2 AND $3 ORDER BY t.start_ms",
                           description_id, t_ms - RECENT_DIALOGUE_MS, t_ms)
    texts = await pool.fetch("SELECT full_text FROM screen_texts WHERE description_id = $1 AND start_ms BETWEEN $2 AND $3",
                             description_id, lo, t_ms)
    chars = await pool.fetch("SELECT name, appearance FROM characters WHERE description_id = $1 ORDER BY id", description_id)
    return {
        "현재 시각": mmss(t_ms),
        "영상 요약": d["summary_text"] if d else None,
        "장면(앞 장면, 지금 장면)": [{"시작": mmss(s["start_ms"]), "제목": s["title"], "장면 설명": s["scene_description"]} for s in scenes],
        "최근 60초 대사": [{"시각": mmss(x["start_ms"]), "말한 사람": x["speaker"], "대사": x["text"]} for x in dia],
        "화면 글자": [x["full_text"] for x in texts],
        "등장인물": [{"이름": c["name"], "겉모습": c["appearance"]} for c in chars],
    }


def split_sentences(buf: str) -> tuple[list[str], str]:
    """완성된 문장들과 남은 조각."""
    out = []
    while True:
        m = SENTENCE.match(buf.lstrip())
        if not m:
            return out, buf
        out.append(m.group(1).strip())
        buf = buf.lstrip()[m.end():]


def character_answer(question: str, ctx: dict) -> list[str] | None:
    """"하치와레는 어떻게 생겼어?"처럼 등장인물 이름이 들어간 겉모습 질문은 저장된 인물 자료로 바로 답한다(AI 호출 없음)."""
    if not re.search(r"(생겼|생김새|모습|외모|겉모습|어떻게 보여)", question):
        return None
    hits = [c for c in ctx.get("등장인물", []) if c["이름"] and c["이름"] in question and c["겉모습"]]
    if not hits:
        return None
    return [f"{c['이름']}의 겉모습은 이래요. {c['겉모습'].rstrip('.')}." for c in hits]


def scene_now(ctx: dict) -> list[str]:
    """SCENE_NOW: 지금 장면 제목과 장면 설명을 문장으로."""
    scenes = ctx["장면(앞 장면, 지금 장면)"]
    if not scenes:
        return ["이 시각의 장면 설명이 없어요."]
    s = scenes[-1]
    sentences, rest = split_sentences((s["장면 설명"] or "") + " ")
    out = [f"{s['제목']}."] + sentences
    if rest.strip():
        out.append(rest.strip())
    return out


def no_ai_answer(question: str, ctx: dict) -> list[str]:
    """GMS 키가 없을 때(개발용): 저장된 자료로 답할 수 있으면 답하고, 아니면 그렇다고 알린 뒤 지금 장면을 설명한다."""
    direct = character_answer(question, ctx)
    if direct:
        return direct
    return ["지금은 AI 답변이 꺼져 있어요. 대신 지금 장면을 알려 드릴게요."] + scene_now(ctx)[:2]


def _prompt(question: str, ctx: dict) -> str:
    return f"해설 자료:\n{json.dumps(ctx, ensure_ascii=False)}\n\n질문: {question}"


def _config() -> types.GenerateContentConfig:
    return types.GenerateContentConfig(system_instruction=SYSTEM, temperature=0.2, max_output_tokens=200,
                                       thinking_config=types.ThinkingConfig(thinking_budget=0))


async def answer_sentences(gms, question: str, ctx: dict, chat_log_id: int | None) -> AsyncIterator[str]:
    """Gemini 답변을 문장 단위로 낸다. GmsClient에 stream()이 있으면 문장이 완성되는 대로, 없으면 한 번에 받아 나눈다."""
    from app.gms.client import CallContext

    call = CallContext("QUESTION", chat_log_id=chat_log_id)
    stream = getattr(gms, "stream", None)
    buf = ""
    if stream is not None:
        async for ch in stream(ANSWER_MODEL, [_prompt(question, ctx)], _config(), call):
            buf += ch.text or ""
            done, buf = split_sentences(buf)
            for s in done:
                yield s
    else:
        r = await gms.generate(ANSWER_MODEL, [_prompt(question, ctx)], _config(), call)
        done, buf = split_sentences(r.text or "")
        for s in done:
            yield s
    if buf.strip():
        yield buf.strip()
