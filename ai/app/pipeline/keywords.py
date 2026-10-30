"""목차 키워드를 AI 없이 뽑는다(크레딧 0). 장면 제목과 그 장면의 해설 문장에서 낱말을 골라 조사를 떼어 낸다.

데모 backend/app/pipeline/keywords.py를 그대로 옮겼다. 말로 장면 찾기(/internal/chat/seek)가 이 키워드로 먼저 찾는다.
"""
import re
from collections import Counter

STOP = {"장면", "화면", "모습", "있습니다", "합니다", "보입니다", "나타납니다", "있는", "하는", "한", "그", "이", "저", "것", "등",
        "위", "아래", "앞", "뒤", "속", "안", "밖", "중", "두", "세", "여러", "다른", "함께", "다시", "계속", "곳", "때", "채"}
JOSA = re.compile(r"(으로|에서|에게|까지|부터|처럼|이랑|하고|와|과|을|를|은|는|이|가|의|에|로|도|만|랑)$")
VERB_END = re.compile(r"(합니다|습니다|ㅂ니다|니다|하며|하고|하는|하다|해요|입니다|있다|된다|한다)$")


def _words(text: str) -> list[str]:
    out = []
    for w in re.findall(r"[0-9A-Za-z가-힣]+", text):
        if VERB_END.search(w):
            continue
        if len(w) >= 3:
            w = JOSA.sub("", w)
        elif len(w) == 2:
            w = re.sub(r"(을|를|은|는|이|가|의)$", "", w) or w
        if len(w) >= 2 and w not in STOP:
            out.append(w.lower())
    return out


def extract(title: str, lines: list[str], limit: int = 6) -> list[str]:
    """제목의 낱말을 먼저, 그다음 해설 문장에서 자주 나온 낱말 순으로 최대 limit개."""
    title_words = _words(title)
    counts = Counter(_words(" ".join(lines)))
    picked: list[str] = []
    for w in title_words + [w for w, _ in counts.most_common()]:
        if w not in picked:
            picked.append(w)
        if len(picked) >= limit:
            break
    return picked
