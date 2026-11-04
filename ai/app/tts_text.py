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
    # 규칙(transliterate)으로 틀리게 나오는 자주 쓰는 말
    "the": "더", "and": "앤드", "gemini": "제미나이", "kore": "코레", "studio": "스튜디오", "penguin": "펭귄", "minecraft": "마인크래프트",
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
    # 약어(GPU·TTS)와 모음 없는 말만 알파벳으로 읽는다. 보통 단어까지 알파벳으로 읽어 영상 제목 "Caminandes Llamigos"가
    # "씨에이엠아이…"로 나왔다(2026-11-03, 화면 쪽은 단어째 넘겨도 Supertonic 앞에서 이 함수가 다시 철자로 바꿨다)
    # 대문자 4~5자는 첫 글자 말고도 모음이 있으면 단어로 읽는다(BEST·BREAD). 모두 철자로 읽어 화면 제목 "THE BEST BARBER"가
    # "더 비이에스티 바버"로 나왔다(데모 2026-11-04). ESPN처럼 모음이 첫 글자뿐이거나 3자 이하(KBS)면 약어
    acronym = word.isupper() and (len(word) <= 3 or (len(word) <= 5 and not re.search(r"[AEIOUY]", word[1:])))
    if acronym or not re.search(r"[aeiouy]", low):
        return "".join(LETTERS[c.upper()] for c in word)
    return transliterate(low)


# 영어 → 한글 발음(외래어 표기에 가깝게, 규칙 기반이라 대략). 사전에 없는 이름·제목을 단어째 읽게 한다
_ONSET = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
_VOWEL = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"
_CODA = " ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ"
EN_CONS = {"sch": "ㅅ", "sh": "sh", "ch": "ㅊ", "th": "ㅅ", "ph": "ㅍ", "ck": "ㅋ", "ng": "ng", "qu": "kw", "wh": "w",
           "b": "ㅂ", "c": "ㅋ", "d": "ㄷ", "f": "ㅍ", "g": "ㄱ", "h": "ㅎ", "j": "ㅈ", "k": "ㅋ", "l": "ㄹ", "m": "ㅁ",
           "n": "ㄴ", "p": "ㅍ", "q": "ㅋ", "r": "r", "s": "ㅅ", "t": "ㅌ", "v": "ㅂ", "w": "w", "x": "x", "y": "y", "z": "ㅈ", "λ": "λ"}
EN_VOWELS = {"eau": "ㅗ", "ee": "ㅣ", "ea": "ㅣ", "oo": "ㅜ", "ai": "ㅔㅣ", "ay": "ㅔㅣ", "ey": "ㅔㅣ", "oa": "ㅗ",
             "ou": "ㅏㅜ", "ow": "ㅗ", "au": "ㅗ", "aw": "ㅗ", "ie": "ㅣ", "oi": "ㅗㅣ", "oy": "ㅗㅣ", "ue": "ㅜ",
             "a": "ㅏ", "e": "ㅔ", "i": "ㅣ", "o": "ㅗ", "u": "ㅜ", "y": "ㅣ"}
_GLIDE_Y = {"ㅏ": "ㅑ", "ㅓ": "ㅕ", "ㅗ": "ㅛ", "ㅜ": "ㅠ", "ㅔ": "ㅖ"}
_GLIDE_W = {"ㅏ": "ㅘ", "ㅓ": "ㅝ", "ㅗ": "ㅝ", "ㅔ": "ㅞ", "ㅣ": "ㅟ"}
_CODA_OK = {"ㄴ": "ㄴ", "ㅁ": "ㅁ", "ng": "ㅇ", "ㄹ": "ㄹ", "ㅋ": "ㄱ", "ㅍ": "ㅂ"}
_EN_UNIT = re.compile("|".join(sorted(list(EN_CONS) + list(EN_VOWELS), key=len, reverse=True)))


def _syl(onset: str, vowel: str, coda: str = " ") -> str:
    return chr(0xAC00 + (_ONSET.index(onset) * 21 + _VOWEL.index(vowel)) * 28 + _CODA.index(coda))


def transliterate(word: str) -> str:
    """caminandes → 카미난데스, llamigos → 라미고스, shaun → 숀, pingu → 핑구. 모음 앞 자음은 첫소리, 남는 자음은
    받침(n·m·ng·l, 낱말 끝 k·p) 또는 'ㅡ'를 붙인 음절로. 모음 뒤 r은 읽지 않고(er·ir·ur은 '어'), 낱말 끝 e는 읽지 않는다."""
    w = re.sub(r"c(?=[eiy])", "s", word)  # ce·ci는 ㅅ(city → 시티)
    w = re.sub(r"(?<=[^aeiou])e$", "", w) if len(w) > 3 else w
    w = re.sub(r"(?<=[aeiou])ll(?=[aeiouy])", "λ", w)  # 모음 사이 ll은 ㄹㄹ(hello → 헬로)
    w = re.sub(r"([bcdfgklmnprstvz])\1", r"\1", w)  # 겹자음은 하나로(llama → 라마)
    w = re.sub(r"[eiu]r(?![aeiouy])", "ə", w)
    w = re.sub(r"(?<=[aeiouə])r(?![aeiouy])", "", w)
    units = []
    for m in re.finditer(r"ə|" + _EN_UNIT.pattern, w):
        u = m.group()
        is_vowel = u == "ə" or (u in EN_VOWELS and not (u == "y" and m.end() < len(w) and w[m.end()] in "aeiou"))
        units.append(("V", "ㅓ" if u == "ə" else EN_VOWELS[u]) if is_vowel else ("C", EN_CONS[u]))
    out: list[str] = []
    for i, (kind, val) in enumerate(units):
        prev = units[i - 1] if i else None
        if kind == "V":
            if prev and prev[0] == "C":
                continue  # 앞 자음과 한 음절로 이미 만들었다
            out += [_syl("ㅇ", v) for v in val]
            continue
        nxt = units[i + 1] if i + 1 < len(units) else None
        if nxt and nxt[0] == "V":
            v0, rest = nxt[1][0], nxt[1][1:]
            onset = val
            if val == "sh":
                onset, v0 = "ㅅ", _GLIDE_Y.get(v0, "ㅟ" if v0 == "ㅣ" else v0)
            elif val in ("y", "w"):
                onset, v0 = "ㅇ", (_GLIDE_Y if val == "y" else _GLIDE_W).get(v0, v0)
            elif val == "kw":
                out.append(_syl("ㅋ", "ㅡ"))
                onset, v0 = "ㅇ", _GLIDE_W.get(v0, v0)
            elif val == "x":
                out.append(_syl("ㅋ", "ㅡ"))
                onset = "ㅅ"
            elif val == "r":  # r은 앞 음절에 받침을 붙이지 않는다(트레인·스프링)
                onset = "ㄹ"
            elif val == "λ":
                if out and (ord(out[-1]) - 0xAC00) % 28 == 0:
                    out[-1] = chr(ord(out[-1]) + _CODA.index("ㄹ"))
                onset = "ㄹ"
            elif val == "ng":  # 모음 앞 ng: 받침 ㅇ + ㄱ(pingu → 핑구)
                if out and (ord(out[-1]) - 0xAC00) % 28 == 0:
                    out[-1] = chr(ord(out[-1]) + _CODA.index("ㅇ"))
                onset = "ㄱ"
            elif val == "ㄹ" and out and out[-1][-1:] and (ord(out[-1]) - 0xAC00) % 588 // 28 == _VOWEL.index("ㅡ")                     and (ord(out[-1]) - 0xAC00) % 28 == 0:
                out[-1] = chr(ord(out[-1]) + _CODA.index("ㄹ"))  # 자음 + l: 블렌더·클럽
            out.append(_syl(onset, v0))
            out += [_syl("ㅇ", v) for v in rest]
            continue
        # 뒤에 모음이 없는 자음: 앞 음절 받침 또는 'ㅡ'를 붙인 음절
        last = out[-1] if out else ""
        end_only = val in ("ㅋ", "ㅍ")
        if last and (ord(last) - 0xAC00) % 28 == 0 and val in _CODA_OK and (not end_only or nxt is None):
            out[-1] = chr(ord(last) + _CODA.index(_CODA_OK[val]))
        elif val == "sh":
            out.append(_syl("ㅅ", "ㅣ"))
        elif val in ("ㅊ", "ㅈ"):
            out.append(_syl(val, "ㅣ"))
        elif val == "x":
            out += [_syl("ㅋ", "ㅡ"), _syl("ㅅ", "ㅡ")]
        elif val in ("y", "w", "kw"):
            out.append(_syl("ㅇ", "ㅣ" if val == "y" else "ㅜ"))
        else:
            out.append(_syl({"ng": "ㅇ", "r": "ㄹ"}.get(val, val), "ㅡ"))
    return "".join(out)


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
