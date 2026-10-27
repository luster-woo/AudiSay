"""Gemini 전체 해설 응답 형식과 지시문 (PoC tests/gemini/describe_nested.py, Jira S15P31D101-217).

시각은 "MM:SS" 문자열로 받는다. 숫자(초)로 받으면 Gemini가 '분:초'를 이어 붙인 값(12:14 → 1214)과
진짜 초를 섞어 써서 믿을 수 없다.
"""
from typing import Literal, Optional

from pydantic import BaseModel, Field

TS = "영상 시작부터의 시각, 반드시 MM:SS 형식(예: 01:05, 12:14)"

CATEGORY_KO = Literal["교육", "요리·음식", "게임", "음악", "과학·IT", "뉴스", "예능", "스포츠", "기타"]
CATEGORY_CODE = {"교육": "EDUCATION", "요리·음식": "COOKING", "게임": "GAME", "음악": "MUSIC", "과학·IT": "SCIENCE_IT",
                 "뉴스": "NEWS", "예능": "ENTERTAINMENT", "스포츠": "SPORTS", "기타": "ETC"}
TEXT_TYPES = Literal["SUBTITLE", "TITLE", "SLIDE", "TABLE", "FORMULA", "SCOREBOARD", "NAME_TAG", "UI", "OTHER"]
IMPORTANCE_CODE = {"상": "HIGH", "중": "MEDIUM", "하": "LOW"}


class Dialogue(BaseModel):
    start: str = Field(description=TS)
    end: str = Field(description=TS)
    speaker: Optional[str] = Field(description="말한 사람. 근거가 없으면 null")
    text: str = Field(description="대사 원문(외국어면 한국어 번역을 괄호로 덧붙임)")


class ScreenText(BaseModel):
    text: str
    text_type: TEXT_TYPES = Field(description="SUBTITLE 자막, TITLE 제목, SLIDE 발표 화면, TABLE 표, FORMULA 수식, "
                                              "SCOREBOARD 점수판, NAME_TAG 이름표, UI 화면 메뉴, OTHER 기타")
    importance: Literal["상", "중", "하"]
    same_as_dialogue: bool = Field(description="대사와 같은 내용의 자막이면 true")


class Person(BaseModel):
    name: Optional[str] = Field(description="이름. 이름 자막·대사 속 호명·제목 같은 근거가 있을 때만, 없으면 null")
    basis: Optional[str] = Field(description="이름의 근거(예: '이름 자막', '대사에서 ○○라고 부름'). 이름이 null이면 null")
    appearance: str = Field(description="위치·옷차림·나이대 등 겉모습")


class Scene(BaseModel):
    start: str = Field(description=TS)
    end: str = Field(description=TS)
    title: str = Field(description="장면 목차용 한 줄 제목(사람의 나이대·옷차림 같은 속성 포함)")
    people: list[Person]
    screen_text: list[ScreenText]


class Line(BaseModel):
    at: str = Field(description="해설을 읽기 시작할 시각, MM:SS. 가능하면 대사가 없는 틈")
    # SDK 스키마 변환이 숫자 Literal을 못 받아 int + 설명으로 둔다
    level: int = Field(description="이 문장을 읽기 시작하는 상세도. 1, 2, 3 중 하나. 1=최소부터, 2=기본부터, 3=최대에서만")
    text: str = Field(description="해설 한 문장")


class Narration(BaseModel):
    category: CATEGORY_KO
    summary_30s: str = Field(description="30초 안에 읽을 수 있는 영상 요약")
    dialogue: list[Dialogue]
    scenes: list[Scene]
    lines: list[Line]


PROMPT = """당신은 시각장애인을 위한 화면해설 작가입니다. 이 영상을 처음부터 끝까지 보고 듣고 아래 JSON을 만드세요.

공통 규칙
- 모든 시각은 영상 시작부터의 MM:SS 형식(예: 01:05).
- dialogue: 들리는 모든 대사를 시간 순서대로. 외국어면 한국어 번역을 괄호로 덧붙임.
- scenes: 장면이 바뀔 때마다 하나씩, 영상 전체를 빠짐없이 덮도록.
- 사람 이름은 이름 자막, 대사 속 호명, 영상 제목처럼 근거가 있을 때만 쓰고 basis에 근거를 적습니다. 근거가 없으면 위치·옷차림으로 구분합니다.
- screen_text 중요도: 상(제목·이름·숫자·핵심 정보), 중(보조 설명), 하(로고·워터마크 등). 대사와 같은 자막은 same_as_dialogue를 true로.

해설 문장(lines) 규칙 — 누적형
- 해설은 짧은 문장 여러 개로 씁니다. 한 문장은 한 가지 내용만, 40자 안팎.
- 문장마다 level을 붙입니다. 사용자는 상세도 1이면 level 1 문장만, 2면 level 1·2, 3이면 level 1·2·3 문장을 모두 듣습니다.
  - level 1: 이 영상을 이해하는 데 꼭 필요한 것. 장면이 바뀜, 핵심 행동, 중요한 화면 글자(제목·이름·숫자).
  - level 2: 보통 시청에 필요한 것. 인물의 행동·표정·장소.
  - level 3: 있으면 좋은 세부. 옷차림, 배경, 분위기, 작은 소품.
- 같은 내용을 단계별로 다시 쓰지 않습니다. level 2·3 문장은 level 1 문장에 '더해지는' 새 정보만 담습니다.
- 어떤 단계만 골라 들어도 말이 되어야 합니다. 문장 하나만 들어도 뜻이 통하게 쓰고, "그", "이어서", "또한"처럼 앞 문장을 가리키는 말을 쓰지 않습니다.
- at은 그 장면이 시작된 뒤, 대사가 없는 틈을 우선 고릅니다. 같은 틈에 여러 문장을 넣을 때는 level 1 문장을 먼저 둡니다.
- 화면에 보이는 것만 현재형으로 쓰고 추측하지 않습니다. 대사 내용을 반복하지 않습니다.
- 영상 1분당 level 1은 2~4문장, level 2는 3~6문장, level 3은 2~5문장 정도로 씁니다.
"""


def to_ms(ts: str) -> int:
    """'MM:SS', 'H:MM:SS', 'MM:SS.s' → 밀리초."""
    sec = 0.0
    for x in str(ts).strip().split(":"):
        sec = sec * 60 + float(x)
    return int(round(sec * 1000))
