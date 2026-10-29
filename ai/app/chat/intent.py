"""발화 분석(/internal/chat/intent): QUESTION / SCENE_NOW / SEEK_SCENE / SEEK_TIME / SETTING / ACTION / UNKNOWN.

규칙으로 확실히 알 수 있는 말(시각 이동, 설정, 재생·멈춤, 의문사가 있는 질문)은 AI를 부르지 않는다(빠르고 크레딧 0).
애매한 말만 gemini-3.1-flash-lite에 JSON 스키마로 묻는다(ai_pipeline_spec 3.2).

데모 backend/app/chat/intent.py를 옮겼다. by_rules는 순수 함수(시험 있음), by_ai만 팀 GmsClient(비동기)로 바꿨다.
H200(Qwen3-VL) 경로(by_remote)는 3차(GPU 서버 위치가 정해진 뒤)로 미뤘다.
"""
import re
from dataclasses import asdict, dataclass, field
from typing import Literal

from google.genai import types
from pydantic import BaseModel, Field

INTENT_MODEL = "gemini-3.1-flash-lite"
Intent = Literal["QUESTION", "SCENE_NOW", "SEEK_SCENE", "SEEK_TIME", "SETTING", "ACTION", "UNKNOWN"]


@dataclass
class Parsed:
    intent: str
    targetMs: int | None = None
    sceneQuery: str | None = None
    setting: dict = field(default_factory=dict)  # {"detailLevel": 3}, {"speechRate": 1.5}, {"subtitleReading": "OFF"}
    action: str | None = None  # PLAY / PAUSE / WHERE / SUMMARY
    by: str = "RULE"  # RULE / AI
    relativeMs: int | None = None  # "5초 뒤로"처럼 지금 위치 기준 이동이면 ±ms(FE가 "5초 앞으로"라고 말해 주게)

    def dict(self) -> dict:
        return asdict(self)


MOVE = r"(가|가줘|가 줘|이동|넘겨|돌려|틀어|보여|찾아)"
SCENE_HINT = re.compile(r"(장면|나오는|나온|나왔던|부분|데로|곳으로|때로)")


def _time_ms(u: str) -> int | None:
    m = re.search(r"(\d+)\s*시간", u)
    h = int(m.group(1)) if m else 0
    mm = re.search(r"(\d+)\s*분(?:\s*(\d+)\s*초)?", u)
    if mm:
        return ((h * 60 + int(mm.group(1))) * 60 + int(mm.group(2) or 0)) * 1000
    ss = re.search(r"(\d+)\s*초", u)
    if ss:
        return (h * 3600 + int(ss.group(1))) * 1000
    m2 = re.search(r"(\d{1,2}):(\d{2})", u)  # "3:20"
    if m2:
        return (int(m2.group(1)) * 60 + int(m2.group(2))) * 1000
    return None


# 시간 기준(사용자 결정 2026-10-28): "뒤·이후" = 나중(앞으로 넘기기), "앞·이전" = 먼저(되돌리기)
FORWARD = re.compile(r"(이후로|후로|뒤로|뒤에|지나서|넘겨|건너|더 가|스킵|빨리 감)")
BACKWARD = re.compile(r"(전으로|이전으로|앞으로|앞에|되감|돌려|돌아가)")


def by_rules(u: str, duration_ms: int, now_ms: int = 0) -> Parsed | None:
    """규칙으로 분류한다. 모르면 None(AI에게 묻는다). duration_ms가 0이면 영상 길이를 모르는 것(시각을 자르지 않고,
    '마지막으로'는 targetMs null → FE가 끝으로 간다)."""
    s = re.sub(r"\s+", " ", u.strip())
    clamp = (lambda t: min(t, duration_ms)) if duration_ms > 0 else (lambda t: t)  # noqa: E731
    if not s:
        return Parsed("UNKNOWN")
    # 설정
    if "상세도" in s or re.search(r"(자세히|간단히|짧게) (해설|들려|말해|설명)", s):
        lv = 3 if re.search(r"(최대|자세히|3)", s) else 1 if re.search(r"(최소|간단히|짧게|1)", s) else 2
        return Parsed("SETTING", setting={"detailLevel": lv})
    if "속도" in s or re.search(r"(빠르게|느리게|천천히|빨리|느리게) ?(말|읽)", s):
        m = re.search(r"(\d(?:\.\d+)?)\s*배", s)
        if m:
            rate = float(m.group(1))
        else:
            rate = 1.5 if re.search(r"(빠르|빨리)", s) else 0.75 if re.search(r"(느리|천천히)", s) else 1.0
        return Parsed("SETTING", setting={"speechRate": min(2.5, max(0.5, rate))})
    if "자막" in s and re.search(r"(읽|꺼|켜)", s):
        v = "OFF" if re.search(r"(꺼|끄|읽지 마)", s) else "ALL" if "모두" in s or "다 " in s else "DIFFERENT_ONLY"
        return Parsed("SETTING", setting={"subtitleReading": v})
    # 시각 이동
    if re.search(r"처음(으로|부터)", s):
        return Parsed("SEEK_TIME", targetMs=0)
    if re.search(r"(맨 끝|마지막)으로", s):
        return Parsed("SEEK_TIME", targetMs=max(0, duration_ms - 3000) if duration_ms > 0 else None)
    t = _time_ms(s)
    # 상대 이동("5초 뒤로 가줘", "10초 이후로", "30초 전으로"): 지금 위치 기준
    if t is not None and (FORWARD.search(s) or BACKWARD.search(s)):
        delta = t if FORWARD.search(s) else -t
        return Parsed("SEEK_TIME", targetMs=max(0, clamp(now_ms + delta)), relativeMs=delta)
    if t is not None and (re.search(MOVE, s) or re.fullmatch(r"[\d\s분초시간:]+", s)):
        return Parsed("SEEK_TIME", targetMs=clamp(t))
    # 요약 듣기
    if "요약" in s and re.search(r"(들려|보여|읽어|말해|해 ?줘|틀어)", s):
        return Parsed("ACTION", action="SUMMARY")
    # 재생 조작
    if re.search(r"(멈춰|정지|일시 ?정지|스톱|잠깐만)", s) and "속도" not in s:
        return Parsed("ACTION", action="PAUSE")
    if re.search(r"(재생|틀어|계속)", s) and not re.search(r"(속도|장면|부분)", s):
        return Parsed("ACTION", action="PLAY")
    # 지금 위치: 문장 전체가 위치를 묻는 말만("갑옷 씨는 어디로 들어왔어?"는 질문)
    if re.fullmatch(r"(지금 )?(어디(쯤|까지)?( ?왔(어|지|나요))?(야|이야|예요|에요|지|냐|니)?|몇 분(쯤)?(이야|야|이에요|인데|지)?)\??", s):
        return Parsed("ACTION", action="WHERE")
    # 지금 장면 설명
    if re.search(r"(지금|이) 장면(을|이)? ?(설명|뭐|어때|알려)", s) or re.fullmatch(r"(지금 )?(뭐 나와|무슨 장면이야)\??", s):
        return Parsed("SCENE_NOW")
    # 말로 장면 이동. "엔딩크레딧으로 가줘"처럼 장면 힌트 없이 "~(으)로 가/이동"만 있어도 장면 이동
    if SCENE_HINT.search(s) and re.search(MOVE, s):
        return Parsed("SEEK_SCENE", sceneQuery=s)
    if re.search(r"[가-힣](으로|로) ?(가|이동|넘겨|돌려|틀어)", s):
        return Parsed("SEEK_SCENE", sceneQuery=s)
    # 의문사가 있으면 질문(AI를 부르지 않아 첫 소리가 빨라진다). 이동·설정·조작은 위에서 이미 걸렀다
    if re.search(r"(누구|누가|누굴|뭐|무엇|무슨|왜|어떻게|언제|몇|어느|어디)", s):
        return Parsed("QUESTION")
    # "치즈밥 레시피 알려줘", "재료 말해 줘"처럼 의문사 없이 알려 달라는 말도 질문
    if re.search(r"(알려|말해|설명해|읽어|궁금)", s):
        return Parsed("QUESTION")
    return None


class IntentSchema(BaseModel):
    intent: Intent
    target_time: str | None = Field(None, description="SEEK_TIME이면 이동할 시각 MM:SS, 아니면 null")
    scene_query: str | None = Field(None, description="SEEK_SCENE이면 찾을 장면을 짧게, 아니면 null")


INTENT_PROMPT = """시각장애인이 영상을 보다가 한 말을 분류하세요.
- QUESTION: 영상 내용에 대한 질문(누구야, 왜, 뭐 하는 거야)
- SCENE_NOW: 지금 장면을 설명해 달라는 말
- SEEK_SCENE: 특정 장면으로 이동해 달라는 말(장면 내용으로 찾음)
- SEEK_TIME: 특정 시각으로 이동(시각은 MM:SS로)
- SETTING: 상세도·말하기 속도·자막 읽기 같은 설정 변경
- ACTION: 재생, 멈춤, 지금 위치 알려 주기
- UNKNOWN: 알 수 없음
말: """


async def by_ai(gms, utterance: str, chat_log_id: int | None = None) -> Parsed:
    """gemini-3.1-flash-lite에 묻는다. 시각 없는 SEEK_TIME은 장면 이동으로 바꾼다(0초로 가 버리지 않게)."""
    from app.gms.client import CallContext
    from app.pipeline.narration_schema import to_ms

    cfg = types.GenerateContentConfig(response_mime_type="application/json", response_schema=IntentSchema, temperature=0,
                                      thinking_config=types.ThinkingConfig(thinking_budget=0))
    r = await gms.generate(INTENT_MODEL, INTENT_PROMPT + utterance, cfg, CallContext("INTENT", chat_log_id=chat_log_id))
    j = IntentSchema.model_validate_json(r.text)
    p = Parsed(j.intent, by="AI")
    if j.intent == "ACTION":  # 세부 동작은 말에서 고른다(없으면 지금 위치)
        p.action = "PAUSE" if re.search(r"(멈|정지|스톱)", utterance) else "PLAY" if re.search(r"(재생|틀어|계속)", utterance) else "WHERE"
    if j.intent == "SEEK_TIME":
        try:
            p.targetMs = to_ms(j.target_time) if j.target_time else None
        except (ValueError, TypeError):
            p.targetMs = None
        if p.targetMs is None:
            p.intent = "SEEK_SCENE"
    if p.intent == "SEEK_SCENE":
        p.sceneQuery = j.scene_query or utterance
    return p
