"""안내 목소리(Supertonic) 앞단 한국어 정규화: 숫자·기호·영어를 한글 읽기로 바꾸고, 읽을 수 없는 기호·이모지는 지운다.
데모 backend/app/text/ko_normalize.py를 그대로 옮겼다(2026-10-30).
- '140곳' → '백사십 곳', '58%' → '오십팔 퍼센트', '1큰술' → '한 큰술', 'Alt+Shift+Q' → '알트 시프트 큐'
- Supertonic은 모르는 글자가 하나라도 있으면 문장 전체를 거부한다 → 유튜브 제목의 ▶·🅰 같은 기호는 먼저 지운다(drop_symbols)
"""
import re
import unicodedata

DIGITS = "영일이삼사오육칠팔구"
SMALL_UNITS = ["", "십", "백", "천"]
BIG_UNITS = ["", "만", "억", "조"]

# 고유어 수사(1~99)를 쓰는 단위 — 그 외는 한자어 수사
NATIVE_COUNTERS = ["시간", "시", "개", "명", "살", "마리", "번째", "잔", "권", "벌", "대", "가지", "줄", "장", "켤레", "사람",
                   # 요리(2026-10-29: "1큰술"을 "일 큰술"로 읽던 것 → "한 큰술")
                   "큰술", "작은술", "숟가락", "스푼", "컵", "쪽", "알", "송이", "조각", "봉지", "줌", "꼬집", "그릇", "통", "병",
                   "덩이", "포기", "단", "모"]
FRACTION_CHARS = {"½": (1, 2), "⅓": (1, 3), "⅔": (2, 3), "¼": (1, 4), "¾": (3, 4)}
NATIVE_ONES = ["", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉"]
NATIVE_TENS = ["", "열", "스물", "서른", "마흔", "쉰", "예순", "일흔", "여든", "아흔"]
NATIVE_MAX = 99

LETTERS = {"A": "에이", "B": "비", "C": "씨", "D": "디", "E": "이", "F": "에프", "G": "지", "H": "에이치", "I": "아이",
           "J": "제이", "K": "케이", "L": "엘", "M": "엠", "N": "엔", "O": "오", "P": "피", "Q": "큐", "R": "알",
           "S": "에스", "T": "티", "U": "유", "V": "브이", "W": "더블유", "X": "엑스", "Y": "와이", "Z": "지"}

# 자주 나오는 영어 단어 / 서비스명 읽기 사전 (필요하면 추가)
EN_DICT = {
    "qwen": "큐웬", "paddle": "패들", "paddleocr": "패들 오씨알", "easyocr": "이지 오씨알", "melotts": "멜로 티티에스",
    "whisper": "위스퍼", "google": "구글", "youtube": "유튜브", "shorts": "쇼츠", "model": "모델", "chatgpt": "챗지피티",
    "hyperclova": "하이퍼클로바", "naver": "네이버", "kakao": "카카오", "samsung": "삼성", "apple": "애플",
    "iphone": "아이폰", "android": "안드로이드", "windows": "윈도우", "python": "파이썬", "dance": "댄스",
    "challenge": "챌린지", "go": "고", "cool": "쿨", "bad": "배드", "ok": "오케이", "wifi": "와이파이",
}


def sino(n: int) -> str:
    """한자어 수사: 140 → 백사십, 2025 → 이천이십오, 10000 → 만"""
    if n == 0:
        return "영"
    out, group = [], 0
    while n > 0:
        n, chunk = divmod(n, 10000)
        if chunk:
            s = ""
            for i, d in enumerate(reversed(f"{chunk:04d}")):
                d = int(d)
                if d:
                    s = ("" if d == 1 and i > 0 else DIGITS[d]) + SMALL_UNITS[i] + s
            if group > 0 and s == "일":  # 일만 → 만
                s = ""
            out.insert(0, s + BIG_UNITS[group])
        group += 1
    return "".join(out)


def native(n: int, before_counter=True) -> str:
    """고유어 수사(1~99): 6 → 여섯, 20개 → 스무 개"""
    t, o = divmod(n, 10)
    tens = NATIVE_TENS[t]
    if before_counter and t == 2 and o == 0:
        tens = "스무"
    return tens + NATIVE_ONES[o]


def read_number(num: str, counter: str = "") -> str:
    num = num.replace(",", "")
    if "." in num:
        a, b = num.split(".", 1)
        return sino(int(a)) + " 점 " + "".join(DIGITS[int(c)] for c in b)
    n = int(num)
    if counter and any(counter.startswith(c) for c in NATIVE_COUNTERS) and 0 < n <= NATIVE_MAX:
        if counter.startswith("번째") and n == 1:
            return "첫"
        return native(n)
    return sino(n)


def read_english(word: str) -> str:
    low = word.lower()
    if low in EN_DICT:
        return EN_DICT[low]
    # CamelCase / 뒤쪽 대문자 약어 분리: PaddleOCR → Paddle + OCR
    parts = re.findall(r"[A-Z]+(?![a-z])|[A-Z]?[a-z]+", word)
    if len(parts) > 1:
        return " ".join(read_english(p) for p in parts)
    return "".join(LETTERS[c.upper()] for c in word)  # 약어·사전에 없는 단어: 알파벳으로 읽기(EN_DICT에 추가 권장)


UNITS = {"GB": "기가바이트", "MB": "메가바이트", "KB": "킬로바이트", "km": "킬로미터", "kg": "킬로그램",
         "cm": "센티미터", "mm": "밀리미터", "ms": "밀리초", "fps": "프레임"}

COUNTER_RE = "|".join(sorted(NATIVE_COUNTERS + ["년", "월", "일", "분", "초", "원", "층", "강", "위", "점", "회", "학년", "도", "곳", "번"], key=len, reverse=True))


KEY_NAMES = {"alt": "알트", "shift": "시프트", "ctrl": "컨트롤", "control": "컨트롤", "enter": "엔터", "tab": "탭", "esc": "이스케이프",
             "escape": "이스케이프", "space": "스페이스", "home": "홈", "end": "엔드", "delete": "딜리트", "backspace": "백스페이스"}


def fraction(num: int, den: int) -> str:
    """분수: 1/4 → 사분의 일, 1/2 → 이분의 일"""
    return f"{sino(den)}분의 {sino(num)}"


def read_fractions(t: str) -> str:
    """분수 읽기. "1/4~1/2컵"을 "일사에서 일이컵"으로 읽던 것(2026-10-29) → "사분의 일에서 이분의 일 컵"
    - 1½ 큰술 → 한 큰술 반(정수 + ½ 뒤에 단위)
    - ½ 컵 → 이분의 일 컵, 1/4 → 사분의 일"""
    for ch, (a, b) in FRACTION_CHARS.items():
        if (a, b) == (1, 2):
            t = re.sub(rf"(\d+)\s*{ch}\s*({COUNTER_RE})", lambda m: f"{read_number(m.group(1), m.group(2))} {m.group(2)} 반", t)
            t = re.sub(rf"(\d+)\s*{ch}", lambda m: f"{sino(int(m.group(1)))} 점 오", t)
        else:
            t = re.sub(rf"(\d+)\s*{ch}", lambda m, a=a, b=b: f"{sino(int(m.group(1)))}과 {fraction(a, b)}", t)
        t = t.replace(ch, f" {fraction(a, b)} ")
    # 1.5컵 → 한 컵 반(고유어 단위일 때만. 1.5초는 그대로 일 점 오 초)
    native_re = "|".join(sorted(NATIVE_COUNTERS, key=len, reverse=True))
    t = re.sub(rf"(\d+)\.5\s*({native_re})", lambda m: f"{read_number(m.group(1), m.group(2))} {m.group(2)} 반", t)
    t = re.sub(r"(\d+)\s*/\s*(\d+)(\s*)", lambda m: fraction(int(m.group(1)), int(m.group(2))) + (m.group(3) or _space_before(t, m.end())), t)
    return t


def _space_before(t: str, i: int) -> str:
    """분수 뒤에 단위(컵 등)가 바로 붙으면 띄어 읽고, 조사(에서·의)면 붙인다"""
    return " " if re.match(rf"({COUNTER_RE})", t[i:]) else ""


def drop_symbols(text: str) -> str:
    """읽을 수 없는 기호·이모지를 지운다(2026-10-30: 유튜브 제목의 ▶·🅰 때문에 Supertonic이 문장 전체를 거부 →
    안내가 브라우저 음성으로 바뀌던 것). 그림 기호(So·Sk)·제어·서식 문자(이모지 이음·변형 선택자)만 빼고 글자·숫자·문장부호는 그대로."""
    return "".join(" " if unicodedata.category(c) in ("So", "Sk", "Co", "Cs", "Cn") or (unicodedata.category(c) in ("Cc", "Cf") and not c.isspace())
                   or "︀" <= c <= "️" else c for c in text)


def normalize_ko(text: str) -> str:
    t = drop_symbols(text)
    # 단축키: "Alt+Shift+Q" → "알트 시프트 큐"(+는 읽지 않음)
    t = re.sub(r"\b(alt|shift|ctrl|control)\s*\+\s*", lambda m: KEY_NAMES[m.group(1).lower()] + " ", t, flags=re.I)
    t = re.sub(r"\b(enter|tab|esc|escape|space|home|end|delete|backspace)(?![a-z])", lambda m: KEY_NAMES[m.group(1).lower()], t, flags=re.I)
    t = t.replace("%", " 퍼센트").replace("·", ", ").replace("~", "에서 ").replace("&", " 앤 ")
    t = read_fractions(t)
    t = re.sub(r"(\d)\s*°C", r"\1도", t)
    # 영문 단위 (숫자 뒤): 6GB → 6 기가바이트
    for u, k in UNITS.items():
        t = re.sub(rf"(\d)\s*{u}\b", rf"\1 {k}", t)
    # 숫자 + 단위
    t = re.sub(rf"(\d[\d,]*(?:\.\d+)?)\s*({COUNTER_RE})?",
               lambda m: read_number(m.group(1), m.group(2) or "") + (" " + m.group(2) if m.group(2) else ""), t)
    # 영어
    t = re.sub(r"[A-Za-z]+", lambda m: read_english(m.group()), t)
    return re.sub(r"\s+", " ", t).strip()


if __name__ == "__main__":
    for s in ["막대그래프에서 2025년 58%가 가장 높습니다.", "표에서 민간기업은 2024년 85곳, 2025년 140곳입니다.",
              "이번 실험에는 Qwen 모델과 PaddleOCR을 사용했습니다.", "금요일 오후 6시까지 제출", "도서관 3층에서 모이기",
              "1번째 줄, 20개, 3.5초, 10,000원, GPU 6GB"]:
        print(s, "→", normalize_ko(s))
