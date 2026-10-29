"""오픈소스(H200 Qwen3-VL-8B) 번역 가운데 잘못된 것 같은 묶음만 골라 Gemini로 다시 번역한다(2026-10-29 사용자 결정).

고르는 기준(자동, 크레딧 0)
1. 번역이 안 됨: 번역문이 원문과 같거나 한글이 거의 없음
2. 한자·일본 가나가 섞임
3. 숫자가 안 맞음: 원문의 수량(five, 1, a quarter, one half …)과 번역문의 수량(다섯, 1, 사분의 일, 반 …)이 다름
   예) "five garlic cloves" → "마늘 3쪽", "a quarter to one half cup" → "셋분의 일곱"
한계: 숫자는 맞는데 낱말만 틀린 것("turmeric" → "투르메이신")은 고르지 못한다 → TRANSLATE_FIX=all이면 전부 Gemini로 다시 본다.

크레딧: gemini-3.1-flash-lite, 묶음 몇 개면 1~3크레딧(추정). 팀 ai_call_logs.purpose에 TRANSLATE가 없어 STT로 남긴다(BE에 V5 요청).

데모 backend/app/pipeline/translate_fix.py를 그대로 옮기고, Gemini 호출만 팀 GmsClient(비동기)로 바꿨다.
"""
import json
import re
from fractions import Fraction

from google.genai import types
from pydantic import BaseModel

FIX_MODEL = "gemini-3.1-flash-lite"
HANGUL = re.compile(r"[가-힣]")
CJK = re.compile(r"[一-鿿㐀-䶿぀-ヿ]")

EN_NUM = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
          "ten": 10, "eleven": 11, "twelve": 12, "fifteen": 15, "twenty": 20, "thirty": 30}
KO_NATIVE = {"한": 1, "하나": 1, "두": 2, "둘": 2, "세": 3, "셋": 3, "네": 4, "넷": 4, "다섯": 5, "여섯": 6, "일곱": 7, "여덟": 8,
             "아홉": 9, "열": 10, "스무": 20, "스물": 20, "서른": 30}
KO_SINO = {"일": 1, "이": 2, "삼": 3, "사": 4, "오": 5, "육": 6, "칠": 7, "팔": 8, "구": 9, "십": 10}


def _en_quantities(text: str) -> list[Fraction]:
    """영어 원문의 수량. 'a'/'an'은 'a quarter'·'a half'·'a cup'처럼 수량일 때만 센다."""
    t = text.lower()
    out: list[Fraction] = []
    # "a cup and a half", "1 and a half", "one and a half teaspoons" → 1.5
    t = re.sub(r"\b(\d+|a|one|two|three)\s+(?:(?:cup|tablespoon|teaspoon)s?\s+)?and\s+a\s+half\b",
               lambda m: (out.append(Fraction(EN_NUM.get(m.group(1)) or int(m.group(1))) + Fraction(1, 2)) or " "), t)
    t = re.sub(r"\b(a|one)\s+quarter\b", lambda m: (out.append(Fraction(1, 4)) or " "), t)
    # "1 half cup"(받아쓰기가 one half를 숫자로 적음)·"one half"·"a half"·"half" → 1/2
    t = re.sub(r"\b(a|one|1)\s+half\b|\bhalf\b", lambda m: (out.append(Fraction(1, 2)) or " "), t)
    t = re.sub(r"\b(a|one)\s+third\b", lambda m: (out.append(Fraction(1, 3)) or " "), t)
    for a, b in re.findall(r"(\d+)\s*/\s*(\d+)", t):
        out.append(Fraction(int(a), int(b)))
    t = re.sub(r"\d+\s*/\s*\d+", " ", t)
    for d in re.findall(r"\d+(?:\.\d+)?", t):
        out.append(Fraction(d))
    for w in re.findall(r"[a-z]+", t):
        if w in EN_NUM and w not in ("a", "an"):
            out.append(Fraction(EN_NUM[w]))
    return out


def _ko_quantities(text: str) -> list[Fraction]:
    """한국어 번역문의 수량: 숫자, 분수(1/4, 사분의 일), 고유어 수사(다섯 쪽), '반'."""
    t = text
    out: list[Fraction] = []
    # 숫자로 쓴 분수: "1과 2분의 1" → 3/2, "4분의 1" → 1/4 (Gemini가 이렇게 쓴다)
    t = re.sub(r"(\d+)\s*[과와]\s*(\d+)\s*분의\s*(\d+)",
               lambda m: (out.append(Fraction(int(m.group(1))) + Fraction(int(m.group(3)), int(m.group(2)))) or " "), t)
    t = re.sub(r"(\d+)\s*분의\s*(\d+)", lambda m: (out.append(Fraction(int(m.group(2)), int(m.group(1)))) or " "), t)
    t = re.sub(r"(\d+(?:\.\d+)?)\s*[과와]\s*반", lambda m: (out.append(Fraction(m.group(1)) + Fraction(1, 2)) or " "), t)
    for a, b in re.findall(r"(\d+)\s*/\s*(\d+)", t):
        out.append(Fraction(int(a), int(b)))
    t = re.sub(r"\d+\s*/\s*\d+", " ", t)
    for den, num in re.findall(r"([일이삼사오육칠팔구십셋]+)분의\s*([일이삼사오육칠팔구십일곱]+)", t):
        d, n = KO_SINO.get(den, KO_NATIVE.get(den)), KO_SINO.get(num, KO_NATIVE.get(num))
        if d and n:
            out.append(Fraction(n, d))
    t = re.sub(r"[일이삼사오육칠팔구십셋]+분의\s*[일이삼사오육칠팔구십일곱]+", " ", t)
    for d in re.findall(r"\d+(?:\.\d+)?", t):
        out.append(Fraction(d))
    t = re.sub(r"\d+(?:\.\d+)?", " ", t)
    for w in re.findall(r"(한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|스무)\s*(개|쪽|장|컵|큰술|작은술|조각|알|마리|명|번)", t):
        out.append(Fraction(KO_NATIVE[w[0]]))
    out += [Fraction(1, 2)] * len(re.findall(r"(?<![가-힣])반(?=\s*컵|\s*$|\s|[,.])|컵\s*반|큰술\s*반|작은술\s*반", t))
    return out


# 용어집: 원문에 왼쪽 말이 있으면 번역에 오른쪽 말 가운데 하나가 있어야 한다(숫자는 맞는데 낱말만 틀린 것 잡기)
# 예) turmeric → "투르메이신"(X) 강황(O), 향신료 cloves → "마늘"(X) 정향(O)
TERMS = [
    (r"\bturmeric\b", ("강황", "울금", "터메릭")),
    (r"(?<!garlic )\bcloves\b(?!\s+of\s+garlic)", ("정향",)),
    (r"\bgarlic\s+cloves?\b|\bcloves?\s+of\s+garlic\b", ("마늘",)),
    (r"\bginger\b", ("생강",)),
    (r"\bcurry\s+leaves\b", ("커리 잎", "커리잎", "카레 잎")),
    (r"\bcinnamon\b", ("계피", "시나몬")),
    (r"\bpaprika\b", ("파프리카",)),
    (r"\bcoconut\s+milk\b", ("코코넛 밀크", "코코넛밀크", "코코넛 우유", "코코넛우유")),
    (r"\b(green\s+)?chil(?:i|li)es\b", ("고추",)),
    (r"\bonions?\b", ("양파",)),
    (r"\bsalt\b", ("소금",)),
]


FORMAL_END = re.compile(r"(니다|습니다|이다|한다|된다|있다|없다|ㄴ다|는다|버전이다|[^요]다)\s*[.!?]?\s*$")


def style_problem(translated: str) -> str | None:
    """말투 검사: 대사는 해요체로 통일한다(2026-10-29 사용자: "말투 통일, 대화하고 있으면 대화체로").
    '~합니다', '~이다'로 끝나는 문장이 있으면 걸린다. 끝맺지 않은 조각(다음 묶음으로 이어지는 말)은 보지 않는다."""
    for sent in re.split(r"(?<=[.!?])\s+", translated.strip()):
        s = sent.strip()
        if s and re.search(r"[.!?]$", s) and FORMAL_END.search(s):
            return "말투(해요체 아님)"
    return None


def term_problem(original: str, translated: str) -> str | None:
    o = original.lower()
    for pat, kos in TERMS:
        if re.search(pat, o) and not any(k in translated for k in kos):
            return f"용어 누락({kos[0]})"
    return None


def problem(original: str, translated: str) -> str | None:
    """번역이 잘못된 것 같으면 이유, 괜찮으면 None"""
    if translated.strip() == original.strip() or len(HANGUL.findall(translated)) < max(2, len(translated) // 5):
        return "번역 안 됨"
    if CJK.search(translated):
        return "한자·가나 섞임"
    en, ko = sorted(_en_quantities(original)), sorted(_ko_quantities(translated))
    if en != ko:
        return f"숫자 다름(원문 {[str(x) for x in en]} / 번역 {[str(x) for x in ko]})"
    return term_problem(original, translated) or style_problem(translated)


class Fixed(BaseModel):
    ko: list[str]


SYSTEM = ("영상 대사 번역을 고치는 번역가입니다. 영어 대사 묶음과 기계 번역을 받습니다. 각 묶음을 자연스러운 한국어 구어체로 다시 옮기세요. "
          "숫자와 분량은 원문과 정확히 같게(a quarter → 4분의 1, one half → 2분의 1, five garlic cloves → 마늘 5쪽, "
          "teaspoon → 작은술, tablespoon → 큰술). 재료 이름은 한국에서 쓰는 말로(turmeric → 강황, grated ginger → 간 생강, "
          "cloves → 정향, curry leaves → 커리 잎, green chilies → 풋고추). 말투는 영상 속 사람이 시청자에게 말하는 대화체이므로 "
          "모든 문장을 해요체('~해요', '~예요', '~세요')로 통일하세요('~합니다', '~이다' 금지). "
          "각 묶음은 그 '원문'에 있는 말만 옮기세요. 앞뒤 맥락은 뜻을 이해하는 데만 쓰고, 맥락에 있는 재료·문장을 번역에 넣지 마세요. "
          "원문이 문장 중간에서 끝나면 번역도 거기서 끝내세요(예: '…turmeric powder 1 and a half' → '…강황 가루 1작은술, 그리고 1과 2분의 1'). "
          "묶음 수와 순서를 그대로 지키고 한글로만 쓰세요.")


async def fix_with_gemini(gms, title: str | None, groups: list[dict], idx: list[int], job_id: int | None = None) -> dict[int, str]:
    """idx 묶음만 Gemini로 다시 번역. 앞뒤 묶음을 맥락으로 함께 준다. 실패하면 빈 dict(H200 번역 유지)."""
    from app.gms.client import CallContext

    if not idx:
        return {}
    items = []
    for n, i in enumerate(idx):
        ctx_before = groups[i - 1]["original"] if i > 0 else ""
        ctx_after = groups[i + 1]["original"] if i + 1 < len(groups) else ""
        items.append({"번호": n + 1, "원문": groups[i]["original"], "기계 번역": groups[i]["text"],
                      "앞 맥락(번역하지 않음)": ctx_before, "뒤 맥락(번역하지 않음)": ctx_after})
    prompt = f"영상 제목: {title or '모름'}\n고칠 묶음({len(idx)}개):\n{json.dumps(items, ensure_ascii=False, indent=1)}\n" \
             f'JSON으로만: {{"ko": ["1번 번역", ...]}} ({len(idx)}개)'
    cfg = types.GenerateContentConfig(system_instruction=SYSTEM, response_mime_type="application/json", response_schema=Fixed,
                                      temperature=0.2, thinking_config=types.ThinkingConfig(thinking_budget=0))
    try:
        r = await gms.generate(FIX_MODEL, prompt, cfg, CallContext("STT", job_id=job_id))
        ko = Fixed.model_validate_json(r.text).ko
    except Exception:  # noqa: BLE001 — 번역 고치기는 덤이라 실패하면 H200 번역 유지
        return {}
    if len(ko) != len(idx):
        return {}
    # 고친 결과도 검사한다: 숫자가 원문과 다르면(뒤 묶음 내용을 끌어와 붙이면 숫자가 늘어남) 그 고침은 버리고 H200 번역을 둔다.
    # 2026-10-29: "…1 and a half"로 끝나는 묶음에 다음 묶음의 "소금·정향 3알·코코넛 밀크"를 붙여 내용이 한 칸씩 밀렸던 것
    out = {}
    for i, k in zip(idx, ko):
        k = k.strip()
        if not k or CJK.search(k):
            continue
        if sorted(_en_quantities(groups[i]["original"])) != sorted(_ko_quantities(k)):
            continue
        out[i] = k
    return out


def mode() -> str:
    """TRANSLATE_FIX: failed(기본, 의심 묶음만) | all(전부 Gemini로 다시) | off"""
    from app.config import settings
    return settings().translate_fix
