"""제목으로 고르는 추가 해설 지침(애니메이션 시리즈 등장인물 사전·요리). 데모 backend/app/pipeline/generate.py에서 옮겼다.

유튜브(Gemini, prepare.py)와 업로드(H200, local.py)가 같이 쓴다. 사전 파일은 ai/data/characters/{series}.json.
"""
import json
from pathlib import Path

from app.config import settings

# 제목에 이 말이 있으면 그 시리즈의 등장인물 사전과 해설 지침을 쓴다
SERIES = {"chiikawa": ("먼작귀", "치이카와", "ちいかわ", "chiikawa")}

ANIMATION_GUIDE = """
애니메이션 해설 지침
- 대사가 적고 몸짓·표정·효과음·울음소리로 이야기가 진행됩니다. 행동과 표정 변화(울먹임, 놀람, 기쁨)와 몸짓을 level 1·2에서 구체적으로 씁니다.
- 일본어 음성이면 대사에 한국어 번역을 괄호로 붙입니다. "야!", "하?" 같은 짧은 외침과 울음소리도 dialogue에 기록해서 해설이 그 위에 겹치지 않게 합니다.
- 제목 카드·자막 같은 화면 글자는 screen_text에 적습니다.
"""

COOKING_GUIDE = """
요리 영상 해설 지침
- 재료, 양, 조리 순서, 불 세기·시간처럼 따라 하는 데 필요한 정보를 level 1·2에 씁니다. 화면에 적힌 분량·시간은 screen_text에도 적습니다.
- 재료의 색·모양·익은 정도 변화를 구체적으로 씁니다.
"""


def characters_dir() -> Path:
    p = Path(settings().characters_dir)
    return p if p.is_absolute() else Path(__file__).resolve().parents[2] / p  # ai/ 기준


def series_of(title: str | None) -> str | None:
    t = (title or "").lower()
    return next((k for k, words in SERIES.items() if any(w.lower() in t for w in words)), None)


def character_guide(series: str) -> str:
    """시리즈 등장인물 사전을 프롬프트 글로 만든다."""
    book = json.loads((characters_dir() / f"{series}.json").read_text(encoding="utf-8"))
    people = "\n".join(f"- {c['name']}" + (f"(다른 이름: {', '.join(c['aliases'])})" if c["aliases"] else "")
                       + f": {c['appearance']}" for c in book["characters"])
    return f"""
시리즈 등장인물 사전({book['series']})
{people}
- 화면 속 캐릭터의 겉모습이 위 사전과 맞을 때만 그 이름을 쓰고, basis에 "시리즈 등장인물 사전"이라고 적습니다.
- 사전에 없거나 겉모습이 확실하지 않은 캐릭터는 name을 null로 두고 겉모습(색, 귀 모양, 크기)으로 구분합니다.
- 같은 캐릭터는 영상 끝까지 같은 이름으로 부릅니다.
"""


def genre_guide(title: str | None, characters: bool = True) -> tuple[str, str | None]:
    """제목으로 고른 추가 지침과 시리즈 이름. characters=False면 시리즈 등장인물 사전을 넣지 않는다
    (업로드 영상 파이프라인은 이름을 쓰지 않는다)."""
    series = series_of(title)
    extra = ""
    if series:
        extra += ANIMATION_GUIDE + (character_guide(series) if characters else "")
    if any(w in (title or "") for w in ("요리", "레시피", "만들기")):
        extra += COOKING_GUIDE
    return extra, series


def build_prompt(base_prompt: str, title: str | None) -> tuple[str, str | None]:
    """Gemini 전체 해설 프롬프트 = 기본 PROMPT + 장르 지침 + 제목."""
    extra, series = genre_guide(title)
    tail = f"\n참고: 영상 제목은 \"{title}\"입니다.\n" if title else ""
    return base_prompt + extra + tail, series
