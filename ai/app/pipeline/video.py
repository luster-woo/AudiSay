"""업로드 영상 32B 영상 보기 엔진(UPLOAD_ENGINE=video). 데모 local_pipeline(2026-11-04)에서 옮김.

Qwen3-VL-32B FP8(H200 vLLM)에 영상 파일을 1분 조각으로 넣어 Gemini와 같은 형식의 해설을 받고, 아래를 더한다.
- 대사 화자 구별(H200 /speakers, WavLM 목소리 군집) → 32B가 cast.voices로 인물과 짝짓기
- 지어낸 이름 고치기(성을 뗀 이름·호칭으로), 이름 괄호("금명(어린 시절)")를 "어린 시절, 금명이 …"로
- 문장마다 그 시각 5초를 원래 화질로 다시 보여 맞음/고침/뺌(화면 검사)
- 해설이 끝난 뒤 상세도 1 문장·대사를 글로만 보내 줄거리가 바뀌는 메인 장면 목차(H200 /generate_json)
- 진행률: 조각·검사 문장마다 실제로 끝낸 만큼
H200 gpu_server 버전 22 이상이 필요하다(/describe_video, /generate_json, /speakers, /sounds).
기본은 업로드 영상 파이프라인(상황 먼저, situation.py, 버전 23)이고 UPLOAD_FLOW=old면 위 옛 방식.
"""
import asyncio
import json
import logging
import os
import re
from collections import Counter
from difflib import SequenceMatcher

from app import inference
from app.errors import WorkerError
from app.pipeline import local
from app.pipeline.local import mmss, mmss_ms, translate_segments
from app.pipeline.narration_schema import Narration, to_ms
from app.pipeline.prompts import genre_guide

log = logging.getLogger(__name__)


def _norm(text: str) -> str:
    return re.sub(r"[\W_]+", "", text).lower()


# 소리 분류가 영화 음향을 엉뚱하게 부르는 것(Caminandes 배경음을 "Television", 천 스치는 소리를 "Zipper"로). 해설에 넣지 않는다
SOUND_IGNORE = {"Television", "Radio", "Zipper (clothing)", "Static", "Mechanisms", "Sound effect", "Inside, large room or hall",
                "Outside, rural or natural", "Outside, urban or manmade", "Hubbub, speech noise, speech babble", "Echo"}


# 한자·가나가 없는 글(32B가 "미겔"을 "미格尔"로 썼다, 2026-11-05 모던 패밀리). 스키마 pattern으로 걸면 vLLM이 그 글자를 아예 못 고른다
def no_cjk(n: int) -> str:
    """한자·가나 없이 n자까지. pattern을 걸면 vLLM이 maxLength를 안 지켜(" Miguel 1 2 3 …"으로 출력 한도까지 썼다) 길이도 pattern에 넣는다.
    큰따옴표·역빗금·제어 문자도 뺀다. 넣으면 글 안에 "를 그대로 써서 JSON이 끊겼다(두 번 다 깨져 옛 방식으로 대체, 2026-11-05).
    널 문자는 vLLM 문법 변환기가 받지 않아(500) 제어 문자는 0x01부터."""
    return '^[^"\\\\\u0001-\u001f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]{0,%d}$' % n


CJK = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")


CJK_WORD = re.compile(r"([가-힣]*)[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+")


def korean_only(raw: dict) -> None:
    """저장 전 마지막 거름: 해설 문장에 한자·가나가 남으면 그 문장을 빼고, 제목·요약·인물은 그 글자를 인물 이름으로 바꾸거나 지운다.
    해설 문장 끝에 마침표가 없으면 붙인다(조각 끝 문장이 마침표 없이 나왔다)."""
    names = {p["name"] for s in raw.get("scenes", []) for p in s.get("people", []) if p.get("name")}

    def clean(text: str | None) -> str | None:
        if not text or not CJK.search(text):
            return text
        def name_of(m):  # "미格尔" → 인물 "미겔"(한글 앞부분이 같은 이름이 하나뿐일 때), 아니면 한글 부분만
            hit = [n for n in names if m.group(1) and n.startswith(m.group(1)) and n != m.group(1)]
            return hit[0] if len(hit) == 1 else m.group(1)
        return re.sub(r"\s{2,}", " ", CJK_WORD.sub(name_of, text)).strip()

    raw["lines"] = [x for x in raw.get("lines", []) if not CJK.search(x["text"])]
    for x in raw["lines"]:
        x["text"] = x["text"].rstrip()
        if not re.search(r"[.?!]$", x["text"]):
            x["text"] += "."
    for s in raw.get("scenes", []):
        s["title"] = clean(s.get("title")) or s.get("title")
        for p in s.get("people", []):
            p["name"], p["appearance"] = clean(p.get("name")) or None, clean(p.get("appearance")) or ""
    for c in raw.get("chapters", []):
        c["title"] = clean(c.get("title"))
    raw["summary_30s"] = clean(raw.get("summary_30s")) or ""


def sound_lines(events: list[dict], a_ms: int, b_ms: int) -> str:
    """소리 사건 가운데 [a, b) 구간과 겹치는 것을 "41~45초 기차 경적" 줄로. 같은 이름은 한 번만."""
    out, seen = [], set()
    for e in events:
        name = e.get("ko") or e["label"]
        if e["label"] in SOUND_IGNORE:
            continue
        if e["startMs"] < b_ms and e["endMs"] > a_ms and name not in seen:
            seen.add(name)
            out.append(f"{e['startMs'] // 1000}~{e['endMs'] // 1000}초 {name}")
    return "\n".join(out)


# 영상 통째 보기(서버 버전 18): 장면을 잘라 사진 몇 장씩 보면 앞뒤 흐름을 놓쳐서, 32B에 영상 파일을 그대로 넣고 Gemini와 같은
# 스키마로 해설 전체를 받는다. 모델은 소리를 못 들으니 받아쓰기·소리 사건을 글로 넣고, 대사는 받아쓰기로 바꿔 끼운다.
# 프롬프트는 32B 전용(2026-11-04): Gemini용을 그대로 쓰면 dialogue 규칙(스키마가 0개로 막음)·소리를 듣는다는 가정·
# 문장 수 기준(1분당 7~15, 스키마는 8)이 어긋났고, 8B 요약에 한자("양蹄")가 섞였다. 대사로 이미 말한 내용은 다시 말하지 않는다
VIDEO_PROMPT = """당신은 시각장애인을 위한 화면해설 작가입니다. 이 영상을 처음부터 끝까지 보고 아래 JSON을 만드세요.
당신은 소리를 들을 수 없습니다. 맨 아래 '소리 사건'과 '대사(받아쓰기)'가 이 영상의 소리입니다. 시청자는 그 대사와 소리를 직접 듣습니다.

먼저 할 일: 영상 전체의 줄거리를 이해하세요. 누가 무엇을 원하고, 어떤 위험·사건이 생기고, 그 결과 어떻게 되는지.
해설 문장은 이 원인과 결과가 이어지게 씁니다.

언어
- 모든 글(장면 제목, 해설, 요약)은 한국어 한글로만 씁니다. 한자·일본어·중국어를 쓰지 않습니다.
- 영어는 화면에 나온 글자를 그대로 옮길 때만 씁니다.

dialogue
- 빈 목록으로 둡니다(받아쓰기로 채웁니다).

scenes — 장면
- 장소·시간·상황이 바뀔 때마다 하나씩, 영상 전체를 빈틈없이 덮습니다(앞 장면의 end = 다음 장면의 start). 시각은 MM:SS.
- 컷이 빠르게 바뀌어도 같은 장소에서 같은 일이 이어지면 한 장면으로 묶습니다(예: 바에 앉아 술을 마시며 대화하는 3분은 한 장면).
- title: 그 장면에서 일어난 일을 한 줄로. 다른 장면과 같은 말을 겹쳐 쓰지 않습니다.
- screen_text: 그 장면에 새로 나타난 글자만 원문 그대로, 3개까지. 엔딩 크레딧의 이름 나열은 적지 않습니다(해설에 "엔딩 크레딧이 올라간다" 한 문장).
  화면 구석에 계속 떠 있는 방송 로고·프로그램 제목·방송 시간·워터마크는 처음 나온 장면에만 적고 중요도 하로 둡니다.
  중요도 상(제목 화면·이름 자막·숫자·핵심 정보), 중(보조 설명), 하(로고·워터마크·노래 가사 자막).
  받아쓴 대사와 같은 내용의 자막은 same_as_dialogue true. 외국어 대사를 옮긴 한국어 자막은 false, 중요도 중.
cast — 등장인물(가장 먼저 씁니다)
- 영상 전체에 나오는 주요 인물을 모두 적습니다. 해설·요약에서는 여기서 정한 호칭만 씁니다.
  appearance에는 그 인물을 다른 인물과 가를 수 있는 겉모습을 적습니다(성별·나이대·머리 모양·옷 색, 예: "단발머리에 베이지 코트를 입은 여성").
  name에는 사람·캐릭터 이름만 씁니다. "남성", "여성", "남자" 같은 말이나 시리즈·프로그램 제목은 name이 아닙니다(이름을 모르면 null).
  성은 제목·대사·화면 글자에 나올 때만 붙입니다. 대사에서 "금명아"라고만 부르면 "금명"이라고 씁니다(성을 짐작해 붙이지 않음).
  같은 인물의 다른 나이도 한 이름으로 씁니다. "금명(어린 시절)"처럼 이름에 괄호를 붙이지 않고, 때는 문장에 풉니다
  (예: "어린 시절, 금명이 아빠와 밥을 먹는다").
  먼저 영상 제목에서 사람 이름을 찾으세요. 제목·채널 이름·이름 자막에 나온 이름은 영상 처음부터 근거가 됩니다(basis: "영상 제목").
  제목에 이름이 둘이고 화면에 남녀가 한 명씩이면 겉모습으로 맞춰 처음부터 각자의 이름으로 부르고, 해설·요약에서 "남성", "여성"으로 부르지 않습니다.
  드라마의 제목 속 이름은 대개 배우 이름입니다. 대사로 극중 이름이 밝혀지면 그 뒤로는 극중 이름으로 부릅니다.
  한 번 정한 호칭은 끝까지 똑같이 씁니다.
  대사 앞의 [화자1] 같은 표시는 목소리로 자동으로 나눈 것입니다. 만화는 성우 한 명이 여러 인물을 맡아 다른 인물이 한 화자로
  섞이는 일이 많으니 참고만 합니다. voices에 그 인물이 주로 말한 화자 번호를 적고(모르면 빈 목록), 누가 말했는지는
  ① 대사 흐름 ② 화면 ③ 화자 번호 순서로 판단합니다.
  - 대사 흐름: 누가 누구에게 말하는지(부르는 이름 "이발사님", "초코"), 인사·작별("안녕히 가십시오")·감사·부탁·놀림이 누구 사이에
    오가는지로 상황을 나눕니다. 예: "다 됐습니다" → "최고의 솜씨예요" → "안녕히 가십시오"는 앞 손님이 머리를 하고 나가는 장면이라
    그 뒤에 들어오는 주인공의 일이 아닙니다.
  - 같은 화자 번호라도 대사 흐름이나 화면과 맞지 않으면 대사 흐름과 화면을 따릅니다.
- scenes의 people에는 그 장면에 나오는 인물을 cast와 같은 name·appearance로 적습니다.

windows — 해설 문장(누적형). 영상을 정해진 구간(from~to)으로 나눠 두었습니다. 구간마다 그 구간에 일어난 일을 씁니다.
- 구간마다 lines_1(level 1), lines_2(level 2), lines_3(level 3)을 씁니다. 각 문장의 at은 그 구간 안의 시각입니다.
- 상세도 1이면 level 1만, 2면 level 1·2, 3이면 level 1·2·3을 모두 듣습니다.
  - level 1: 줄거리를 따라가는 데 꼭 필요한 것. 장면 전환, 인물의 첫 등장, 핵심 행동과 그 결과, 중요도 상인 화면 글자.
  - level 2: 인물의 행동·표정·자세·위치 관계.
  - level 3: 옷차림, 배경, 장소의 분위기, 크게 보이는 소품.
    영상이 작고 흐리게 들어오니 손톱·시계·반지·귀걸이·접시 위 음식처럼 작은 것은 쓰지 않습니다. 화면을 크게 차지해 분명한 것만 씁니다.
    옷차림은 people의 appearance와 같게 씁니다(appearance에 베이지 코트면 해설도 베이지 코트).
- level 2·3은 level 1에 더해지는 새 정보만 씁니다. 같은 일을 단계별로 다시 쓰지 않습니다.
- 문장 하나만 들어도 뜻이 통하게 씁니다. "그", "그때", "이어서", "또한", "그녀", "그 남자"처럼 앞 문장에 기대는 말과 대명사를 쓰지 않고 정한 호칭으로 부릅니다.
- 한 문장에 한 가지. 쉼표나 "~하고", "~하며"로 두 동작을 잇지 않습니다. 현재형 평서문. 주어와 동작을 앞에 둡니다.
  level 1은 25자, level 2·3은 30자 이내. 넘으면 둘로 나누거나 덜 중요한 쪽을 버립니다.
- 앞 문장과 같은 행동(계속 술을 마신다, 계속 걷는다)은 다시 쓰지 않습니다. 새로 바뀐 것(잔을 내려놓는다, 고개를 돌린다)만 씁니다.
- 보이는 것만 씁니다. 표정·감정은 화면에서 분명할 때만, 단정하지 말고 몸짓으로("화가 난다" 대신 "주먹을 쥐고 노려본다").
- 아직 일어나지 않은 일을 미리 말하지 않습니다.
- 화면 글자는 "'휴업 중'이라고 적혀 있다"처럼 원문을 살립니다. 노래 가사 자막은 읽지 않습니다.
- 쓰지 않는 표현: "~모습이 보입니다", "~이 보입니다", "화면에", "장면에서", "카메라가", "~것 같다", "~듯하다".
  예: "화면에 '○○' 제목이 보입니다" → "'○○'이라는 제목이 뜬다." / "카메라가 얼굴을 비춘다" → "○○의 얼굴이 가까이 잡힌다."

이미 말한 내용은 다시 말하지 않기
- 시청자는 대사를 직접 듣습니다. 받아쓴 대사로 사람이 이미 말한 내용(무엇을 하는지, 무엇을 만드는지, 이름, 숫자, 감정, 계획)은 해설로 다시 말하지 않습니다.
- 대사를 따옴표로 옮기거나 "~라고 말한다", "~라고 외친다", "~하자고 제안한다", "대화를 나눈다"처럼 말한 사실을 전하지 않습니다.
  예: 대사가 "오늘은 김치찌개를 끓여 볼게요"면 "김치찌개를 끓이려 한다"고 쓰지 않고, 말에 없는 것(냄비에 넣는 재료, 손동작)만 씁니다.
  예: 대사가 "○○야, 왜 울어?"면 "○○가 운다"고 쓰지 않고, "○○가 소매로 눈가를 훔친다"처럼 말로 드러나지 않은 모습을 씁니다.
- 소리 사건에 있는 소리(박수, 경적, 음악)도 다시 말하지 않습니다. 소리의 원인이 화면에 보이면 그 원인을 씁니다("기차가 달려온다").

배치와 분량
- at은 그 일이 화면에 나오는 시각(장면이 바뀌는 시각)입니다. 받아쓴 대사가 이어지는 동안은 피해서 그 앞뒤 틈에 둡니다.
- 대사도 해설도 없는 구간이 15초를 넘지 않게 level 1·2를 고르게 둡니다. 영상 뒷부분도 앞부분과 같은 밀도로 씁니다.
- 구간마다 lines_1은 1~2문장, lines_2는 1~2문장, lines_3은 0~1문장.
- 같은 구간 안에서 lines_1·2·3을 같은 시각에 몰아 쓰지 말고, 구간 안에서 일이 일어나는 순서대로 시각을 나눕니다.
- 앞 구간과 같은 상황이 이어지면 lines_1에는 그 구간에 새로 생긴 변화만 씁니다.
- 대사가 오가는 긴 구간에도 대사 사이 틈에 표정·몸짓 문장을 둡니다.
  대사가 빽빽하면 줄이고, 내용 없는 문장으로 채우지 않습니다.

summary_30s — 영상 전체를 한글 2~3문장으로. 인물은 해설과 같은 이름·호칭으로 부릅니다.

마지막 점검(출력 전에 고칩니다)
- 새 장면마다 level 1 문장이 있는가? level 1만 이어 들어도 줄거리가 이어지는가? level 2·3도 썼는가?
- people에 주요 인물을 모두 적었는가? 같은 행동을 되풀이한 문장은 없는가?
- 받아쓴 대사로 이미 말한 내용을 해설로 되풀이하지 않았는가?
- 한자·일본어·중국어, 쓰지 않는 표현, 대명사, 글자 수 초과가 없는가?
"""


SAID_WINDOW_MS = 15000  # 해설 시각 앞뒤 이 범위의 대사와 견준다


SAID_RATIO = 0.8  # 해설 문장 글자의 80% 이상이 대사에 그대로 있으면 이미 말한 내용으로 본다


def build_video_prompt(title: str, sounds: str, transcript: str) -> str:
    extra, _ = genre_guide(title)  # 시리즈 등장인물 사전·요리 지침(제목에 걸릴 때만)
    return (VIDEO_PROMPT + extra + f"\n영상 제목: \"{title}\"\n"
            f"\n소리 사건(초, 자동 분석이라 틀릴 수 있음):\n{sounds or '(없음)'}\n대사(받아쓰기, 시작~끝):\n{transcript or '(없음)'}\n")


def drop_said(lines: list[dict], segs: list[dict]) -> list[dict]:
    """프롬프트로 막아도 대사를 거의 그대로 옮긴 해설이 남으면 뺀다("오늘은 김치찌개를 끓여 볼게요" → "김치찌개를 끓여 본다").
    해설 문장이 짧은 쪽일 때 그 글자가 근처 대사에 얼마나 들어 있는지(restates)로 본다. 6자 미만 문장은 보지 않는다."""
    out = []
    for x in lines:
        at = to_ms(x["at"])
        near = " ".join(s["text"] for s in segs if abs(s["startMs"] - at) <= SAID_WINDOW_MS or abs(s["endMs"] - at) <= SAID_WINDOW_MS)
        n = _norm(x["text"])
        if near and len(n) >= 6 and len(n) <= len(_norm(near)) and restates(x["text"], near) >= SAID_RATIO:
            continue
        # 대사를 따옴표로 옮기거나 "~라고 말한다", "대화를 나눈다"로 전하는 문장(2026-11-04 먼작귀: "'이거야 이거!'라고 외치며").
        # 말한 사실은 대사로 이미 들리거나(근처 대사) 들리지 않는 말이라 전할 내용이 없다
        if SPEECH_REPORT.search(x["text"]) or (near and any(len(_norm(q)) >= 2 and restates(q, near) >= 0.6
                                                             for q in QUOTED.findall(x["text"]))):
            continue
        if any(w in x["text"] for w in PRONOUNS):  # "남성은 그녀를 바라본다": 누구인지 들어서는 알 수 없다
            continue
        out.append(x)
    return out


QUOTED = re.compile(r"['‘\"“]([^'’\"”]+)['’\"”]")


SPEECH_REPORT = re.compile(r"(라고|자고|냐고|다고)\s*(말|외치|묻|제안|소리치|대답|속삭이|중얼거리)|대화를 나[누눈]|말을 건네|이야기를 나[누눈]|(며|고) (말|대답)한다")


PRONOUNS = ("그녀", "그 남자", "그 여자", "그들")


NOT_A_NAME = re.compile(r"(남성|여성|남자|여자|소년|소녀|아이|사람|인물|[가-힣]+\s*\d)")


# 32B는 영상을 1초 2장·448×256으로 본다. 이보다 작은 것은 지어내기 쉽다(2026-11-04 드라마: 없는 분홍 손톱·손목시계)
TINY_DETAIL = re.compile(r"손톱|시계|반지|귀걸이|목걸이|팔찌|매니큐어|단추|접시|무늬가")


COMPOUND = re.compile(r"^(.{6,}?(고|며)),\s*(.+[이가은는]\s.+)$")


ACTION_WINDOW_MS = 60000  # 이 안에서 같은 동작을 다시 쓰면 뺀다


OBJECT_VERB = re.compile(r"([가-힣]+?)[을를]\s+([가-힣])")


def _places(text: str) -> set[str]:
    """'~에서'로 적은 장소("마이크 앞에서" → 마이크앞)."""
    return {_norm(m) for m in re.findall(r"((?:[가-힣A-Za-z']+ )?[가-힣A-Za-z']+)에서", text) if _norm(m)}


def _actions(text: str) -> set[tuple[str, str]]:
    """'무엇을 + 동작 첫 글자' 짝. "술을 마신다"와 "술을 마시며"가 같은 (술, 마)가 된다."""
    return set(OBJECT_VERB.findall(text))


def drop_repeated_actions(lines: list[dict]) -> list[dict]:
    """1분 안에 같은 동작을 다시 쓴 문장을 뺀다(2026-11-04 드라마: 9문장 중 5문장이 "술을 마신다").
    문장의 '무엇을 + 동작' 짝 절반 이상이 앞서 쓴 것이면 같은 동작을 되풀이한 것으로 본다."""
    out, said = [], []
    for x in lines:
        at, acts = to_ms(x["at"]), _actions(x["text"])
        recent = [(t, a, txt) for t, a, txt in said if abs(at - t) <= ACTION_WINDOW_MS]
        same = {a for _, a, _ in recent} & acts
        # 같은 동작이라도 새 장소에서면 새 장면이라 남긴다: "꽃을 들고 노래를 부르며" 뒤의 "마이크 앞에서 노래를 부르기
        # 시작한다"(2026-11-04 먼작귀)
        new_place = _places(x["text"]) - {p for _, _, txt in recent for p in _places(txt)}
        said += [(at, a, x["text"]) for a in acts]  # 뺀 문장도 견줄 대상에 넣는다(되풀이가 세 번 이어지는 경우)
        if acts and len(same) * 2 >= len(acts) and not new_place:
            continue
        out.append(x)
    return out


def _plain(clause: str) -> str:
    """'~하고'/'~하며'로 끝난 앞 절을 현재형 평서문으로: 지나가고 → 지나간다, 웃으며 → 웃는다, 있고 → 있다."""
    stem = clause[:-1]
    if clause.endswith("며") and stem.endswith("으"):
        stem = stem[:-1]
    if stem.endswith(("있", "없")) or stem.endswith("이"):
        return stem + "다."
    last = stem[-1]
    code = ord(last) - 0xAC00
    if not 0 <= code < 11172:
        return clause + "."
    jong = code % 28
    if jong == 0:  # 받침 없음: 가 → 간다
        return stem[:-1] + chr(ord(last) + 4) + "다."
    if jong == 8:  # ㄹ 받침: 놀 → 논다
        return stem[:-1] + chr(ord(last) - 8 + 4) + "다."
    return stem + "는다."


def split_compound(text: str, level: int) -> list[str]:
    """글자 수를 넘긴 "A가 ~하고, B가 ~한다"를 두 문장으로(2026-11-04: 긴 문장 5개). 뒤 절에 주어가 있을 때만 나눈다."""
    from app.pipeline.describe import LEVEL_MAX_CHARS
    m = COMPOUND.match(text.strip())
    if not m or len(text) <= LEVEL_MAX_CHARS.get(level, 30) + 5:
        return [text]
    return [_plain(m.group(1)), m.group(3).strip()]


def mark_dialogue_subtitles(scenes: list[dict], segs: list[dict]) -> None:
    """대사를 그대로 받아 적은 자막(먼작귀 "요즘 좋아하는 노래가 생겼어")은 이미 들리므로 same_as_dialogue·중요도 하로.
    32B는 받아쓴 대사를 글로만 받아서 화면 자막과 같은 말인 줄 모르고 중요도 중으로 적었다(2026-11-04)."""
    said = " ".join(x["text"] for x in segs)
    for s in scenes:
        for t in s.get("screen_text", []):
            if said and len(_norm(t["text"])) >= 2 and restates(t["text"], said) >= 0.8:
                t["same_as_dialogue"], t["importance"] = True, "하"


def dedupe_screen_texts(scenes: list[dict]) -> None:
    """화면 구석에 계속 떠 있는 로고·프로그램 제목을 장면마다 다시 적은 것을 뺀다(2026-11-04 드라마: '100일의 거짓말'을
    장면 11개에 중요도 상으로 적어 장면마다 읽었다). 앞 장면에 있던 글자는 이어진 것이라 빼고, 장면 절반 넘게 나오는 글자는
    처음 한 번만 중요도 하로 남긴다(장면별 방식의 clean_ocr와 같은 생각)."""
    n = len(scenes)
    count = Counter(_norm(t["text"]) for s in scenes for t in {_norm(t["text"]): t for t in s.get("screen_text", [])}.values())
    persistent = {k for k, c in count.items() if n >= 3 and c >= max(3, n * 0.5)}
    seen, prev = set(), set()
    for s in scenes:
        keep, cur = [], set()
        for t in s.get("screen_text", []):
            k = _norm(t["text"])
            cur.add(k)
            if k in prev or (k in persistent and k in seen):
                continue
            if k in persistent or len(t["text"]) > 30:  # 엔딩 크레딧처럼 긴 이름 나열은 읽지 않는다
                t = {**t, "importance": "하"}
            seen.add(k)
            keep.append(t)
        s["screen_text"] = keep
        prev = cur


CHAPTER_PROMPT = """아래는 영상 "{title}"(길이 {dur})의 해설(화면에서 일어난 일)과 대사입니다. 이 영상의 장면 목차를 만드세요.
시청자가 "○○ 장면으로 가 줘"라고 찾아갈 메인 장면입니다.
- 줄거리에 영향을 주는 장면만 {lo}~{hi}개 고릅니다: 인물이 처음 나옴, 문제가 생김, 결심·갈등, 해결, 결말처럼 이야기가 바뀌는 순간.
  컷이 바뀌거나 인물이 걷는 것처럼 줄거리가 그대로인 곳, 채널 홍보·구독 안내·끝 화면은 목차가 아닙니다.
- start는 그 장면이 시작하는 시각(MM:SS), 시간 순서대로, 첫 목차는 00:00에서 가깝게.
- title은 그 장면에서 무슨 일이 일어나는지 한 줄, 25자 이내(예: "큰머리 컵케이크가 놀림받는다"). 화면 묘사("문을 여는 손")가 아니라 사건으로.
- 해설과 대사에 나온 호칭만 씁니다. 없는 이름이나 관계(여동생·엄마)를 지어내지 않습니다.

해설(시각 문장):
{lines}

대사(시각 문장, 누가 말했는지는 모름):
{dialogue}
"""


def said(seg: dict) -> str:
    """대사 한 줄을 "[누구] 말"로(누가 말했는지 알면). who는 화자 번호("화자2") 또는 맞춘 인물 이름."""
    return f"[{seg['who']}] {seg['text']}" if seg.get("who") else seg["text"]


# 지어낸 이름으로 의심하는 꼴: 흔한 성 + 두 글자. 이 꼴이 아닌 호칭·낱말은 고치지 않는다(2026-11-04 '입장'을 인물로 보고
# "신부 입장"을 "신부 남성"으로 바꿨고, 베이커를 "흰색 요리복 남성"으로 바꿨다)
FULL_NAME = re.compile(r"[김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하곽성차주우구민진나지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예봉경]"
                       r"[가-힣]{2}")


JOSA_PAIRS = (("이", "가"), ("은", "는"), ("을", "를"), ("과", "와"), ("아", "야"), ("이나", "나"), ("이랑", "랑"))


def _has_batchim(word: str) -> bool:
    c = word[-1:]
    return bool(c) and "가" <= c <= "힣" and (ord(c) - 0xAC00) % 28 != 0


def swap_name(text: str, old: str, new: str) -> str:
    """문장 속 이름을 바꾸고 바로 뒤 조사를 받침에 맞춘다("김미정이" → "엄마가", "김철수는" → "관식은")."""
    after = {False: {a: b for a, b in JOSA_PAIRS}, True: {b: a for a, b in JOSA_PAIRS}}[_has_batchim(new)]

    def rep(m):
        josa = m.group(1) or ""
        return new + after.get(josa, josa)
    alts = "|".join(sorted({x for pair in JOSA_PAIRS for x in pair}, key=len, reverse=True))
    if not old:
        return text
    text = re.sub(re.escape(old) + f"({alts})(?![가-힣])", rep, text)  # 조사로 끝나는 것은 받침에 맞춰
    return text.replace(old, new)  # 나머지("김철수의", "김금명이다")는 그대로 바꾼다


NAME_LABEL_PROMPT = """영상 해설에 쓴 인물 이름 가운데 영상 제목·대사·화면 글자 어디에도 나오지 않아 지어낸 것으로 보이는 이름이 있습니다.
각 이름을 겉모습과 대사에 맞는 짧은 호칭으로 바꾸세요. 호칭은 10자 이내 한글이고 새 이름을 지어내지 않습니다.
대사에서 그 인물을 부르는 말(아빠·엄마·선생님·이발사님 등)이 있으면 반드시 그것을 쓰고, 없을 때만 겉모습("검은 정장의 남성")을 씁니다.
같은 사람의 다른 나이(어린 시절·청소년 시절)는 같은 호칭으로 씁니다.
인물(이름: 겉모습):
{people}
대사(받아쓰기, 앞부분):
{dialogue}
"""


# 이름 뒤에 붙인 때 설명: "금명(어린 시절)", "아빠(청년)", "금명(중학생)". 때가 아닌 괄호("(주)넷플릭스")는 건드리지 않는다
NAME_NOTE = re.compile(r"([가-힣A-Za-z]+)\s*\(((?:[^)]{0,10})(?:시절|학생|어린|청년|소년|소녀|노년|젊은|[0-9]+살|[0-9]+대|때)(?:[^)]{0,6}))\)")


def _when(note: str) -> str:
    """괄호 설명을 문장 앞 때 표현으로: "어린 시절" 그대로, "중학생" → "중학생 때"."""
    note = note.strip()
    return note if re.search(r"(시절|때)$", note) else f"{note} 때"


def unbracket_names(raw: dict) -> None:
    """이름 뒤 괄호 설명을 떼고 때는 문장 앞에 푼다: "금명(어린 시절)이 아빠와 걷는다" → "어린 시절, 금명이 아빠와 걷는다".
    괄호를 그대로 읽으면 어색했다(2026-11-04 사용자). 인물 이름의 괄호도 떼서 같은 사람으로 모은다."""
    for x in raw.get("lines", []):
        notes = [m.group(2) for m in NAME_NOTE.finditer(x["text"])]
        text = NAME_NOTE.sub(r"\1", x["text"])
        if notes and not text.startswith(_when(notes[0])):
            text = f"{_when(notes[0])}, {text}"
        x["text"] = text
    for sc in raw.get("scenes", []):
        sc["title"] = NAME_NOTE.sub(r"\1", sc.get("title", ""))
        for p in sc.get("people", []):
            if p.get("name"):
                p["name"] = NAME_NOTE.sub(r"\1", p["name"]).strip()
    raw["summary_30s"] = NAME_NOTE.sub(r"\1", raw.get("summary_30s", ""))


def match_voices(casts: list[list[dict]], segs: list[dict]) -> dict[str, str]:
    """32B가 cast.voices에 적은 화자 번호 → 인물 이름. 조각마다 다르게 적었으면 가장 많이 짝지은 이름으로.
    맞춘 줄은 who를 이름으로 바꾼다(저장할 때 대사의 말한 사람이 된다)."""
    votes: dict[str, Counter] = {}
    for cast in casts:
        for c in cast:
            for v in c.get("voices") or []:
                if c.get("name"):
                    votes.setdefault(v, Counter())[c["name"]] += 1
    names = {v: cnt.most_common(1)[0][0] for v, cnt in votes.items()}
    for s in segs:
        if s.get("who") in names:
            s["who"] = names[s["who"]]
    return names


def chapter_range(duration_ms: int) -> tuple[int, int]:
    """메인 장면 수: 7분이면 5~8개, 1분이면 2~3개."""
    return min(5, max(2, duration_ms // 40_000)), min(8, max(3, duration_ms // 25_000))


def video_schema(schema: dict, duration_ms: int) -> dict:
    """Gemini 스키마에 vLLM이 지키게 할 제약을 더한다. 그대로 두면 32B가 시각을 빈 문자열로 두고, 받아쓰기로 바꿔 끼울
    dialogue를 화면 자막으로 채우다 출력 한도(6,000토큰)에 걸려 JSON이 끊겼다(2026-11-03 이바나 영상)."""
    mmss_rule = {"type": "string", "pattern": "^[0-9]{2}:[0-9]{2}$"}
    defs = schema.get("$defs", {})
    defs["Line"]["properties"]["at"] = mmss_rule
    defs["Scene"]["properties"]["start"] = mmss_rule
    defs["Scene"]["properties"]["end"] = mmss_rule
    schema["properties"]["dialogue"]["maxItems"] = 0
    # 같은 영상에서 화면 글자 하나에 "ㅋㅋㅋ…"를 수천 자 쓰며 멈추지 않았다 → 글자 수·개수 상한
    defs["Line"]["properties"]["text"]["maxLength"] = 100
    defs["ScreenText"]["properties"]["text"]["maxLength"] = 60
    defs["Scene"]["properties"]["title"]["maxLength"] = 60
    defs["Scene"]["properties"]["screen_text"]["maxItems"] = 3
    defs["Scene"]["properties"]["people"]["maxItems"] = 3
    # 출력 토큰이 곧 시간(32B 초당 약 66토큰). 2분 영상을 장면 23개·인물 30번으로 써서 4,500토큰·70초였다(2026-11-04 먼작귀)
    schema["properties"]["scenes"]["maxItems"] = max(4, duration_ms // VIDEO_SCENE_MS)
    schema["properties"]["summary_30s"]["maxLength"] = 300
    # 구간(20초)마다 상세도 1·2를 반드시 쓰게 강제한다(prefixItems + const). 한 목록에 쓰게 하면 32B가 앞 20~25초만 쓰고
    # 끝냈고(먼작귀 세 번), 상세도별 목록으로 나눠도 1·2·3을 같은 시각에 겹쳐 썼다(2026-11-04)
    line = {"type": "object", "properties": {"at": mmss_rule, "text": {"type": "string", "maxLength": 100}},
            "required": ["at", "text"], "additionalProperties": False}
    windows = []
    for start in range(0, duration_ms, VIDEO_WINDOW_MS):
        end = min(duration_ms, start + VIDEO_WINDOW_MS)
        props = {"from": {"const": mmss(start)}, "to": {"const": mmss(end)}}
        for level, (lo, hi) in VIDEO_WINDOW_COUNTS.items():
            props[f"lines_{level}"] = {"type": "array", "items": line, "minItems": lo, "maxItems": hi}
        windows.append({"type": "object", "properties": props, "required": list(props), "additionalProperties": False})
    # cast에만 voices(목소리로 나눈 화자 번호, 서버 버전 22)를 더한다. 장면 people은 그대로
    cast_item = {**defs["Person"], "properties": {**defs["Person"]["properties"], "voices": {
        "type": "array", "items": {"type": "string", "pattern": "^화자[0-9]+$"}, "maxItems": 3}}}
    cast_item["required"] = [*defs["Person"].get("required", []), "voices"]
    old = schema["properties"]
    schema["properties"] = {"category": old["category"], "dialogue": old["dialogue"],
                            "cast": {"type": "array", "items": cast_item, "minItems": 1, "maxItems": 6},
                            "scenes": old["scenes"],
                            "windows": {"type": "array", "prefixItems": windows, "items": False,
                                        "minItems": len(windows), "maxItems": len(windows)},
                            "summary_30s": old["summary_30s"]}
    schema["required"] = list(schema["properties"])
    return schema


def merge_level_lines(result: dict) -> dict:
    """windows(video_schema) → Gemini 형식 lines(level 붙임, 시각은 구간 안으로). cast는 첫 장면 people에 더해 인물로 저장되게.
    옛 형식(lines)이면 그대로."""
    if "lines" not in result:
        lines = []
        for w in result.pop("windows", []):
            lo, hi = to_ms(w["from"]), max(to_ms(w["from"]), to_ms(w["to"]) - 1000)
            for k in VIDEO_WINDOW_COUNTS:
                for x in w.get(f"lines_{k}", []):
                    lines.append({**x, "level": k, "at": mmss(min(max(to_ms(x["at"]), lo), hi))})
        result["lines"] = lines
    cast = result.pop("cast", [])
    if cast and result.get("scenes"):
        first = result["scenes"][0].setdefault("people", [])
        named = {p.get("name") for s in result["scenes"] for p in s.get("people", [])}
        first += [p for p in cast if p.get("name") and p["name"] not in named]
    return result


VIDEO_MIN_GAP_MS = 7000  # 해설 사이 최소 간격


VIDEO_SNAP_MS = 2000  # 장면이 바뀌는 시각이 이만큼 안에 있으면 그 시각으로 옮긴다


VIDEO_WINDOW_MS = 20000  # 해설 구간 길이


VIDEO_WINDOW_COUNTS = {1: (1, 2), 2: (1, 2), 3: (0, 1)}  # 구간마다 (최소, 최대) 문장 수


VIDEO_SCENE_MS = 12000  # 장면은 평균 12초에 하나까지


VIDEO_DETAIL_SHIFT_MS = 15000  # level 2·3을 앞 해설이 끝날 때까지 미루는 한도. 8초면 1·2·3이 한 시각에 몰린 구간에서 3이 다 빠졌다


VIDEO_MAX_SHIFT_MS = 5000  # level 1이 앞 해설과 붙어 있을 때 뒤로 미는 한도(넘으면 뺀다)


def restates(a: str, b: str) -> float:
    """짧은 문장이 긴 문장 안에 얼마나 그대로 들어 있는지(0~1). "라마가 등대 위에서 펭귄을 바라보며 웃음"과
    "라마는 등대 위에서 펭귄을 바라보며, 펭귄은 옆에 앉아 있다"처럼 뒤에 한 마디를 덧붙인 문장은 비슷한 정도(ratio)로는 0.7 아래라
    걸러지지 않았다(2026-11-03 Caminandes, level 2가 level 1을 거의 그대로 다시 씀)."""
    a, b = sorted((_norm(a), _norm(b)), key=len)
    if not a:
        return 1.0
    return sum(m.size for m in SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks()) / len(a)


def scene_cuts(video) -> list[int]:
    """장면이 바뀌는 시각(ms). 자르지 않고 그대로(detect_scenes는 짧은 장면을 붙인다)."""
    from scenedetect import ContentDetector, detect
    return [int(a.seconds * 1000) for a, _ in detect(str(video), ContentDetector())]


def speech_ms(text: str) -> int:
    """읽는 데 걸리는 시간 어림(한국어 TTS 초당 5~6자) + 숨 0.5초."""
    return max(800, len(text) * 180) + 500


def free_slot(kept: list[dict], ms: int, text: str) -> int | None:
    """kept 해설과 읽는 시간이 겹치지 않는 가장 이른 시각(ms 이후, VIDEO_DETAIL_SHIFT_MS 안). 없으면 None."""
    start = ms
    for _ in range(len(kept) + 1):
        hit = next((k for k in kept if k["ms"] < start + speech_ms(text) and start < k["ms"] + speech_ms(k["text"])), None)
        if hit is None:
            return start
        start = hit["ms"] + speech_ms(hit["text"])
        if start - ms > VIDEO_DETAIL_SHIFT_MS:
            return None
    return None


def tidy_video_lines(lines: list[dict], cuts_ms: list[int], duration_ms: int) -> list[dict]:
    """영상 통째 해설 다듬기(2026-11-03 Caminandes 사용자 지적: 너무 잦고, 같은 말 반복, 시간이 안 맞음).
    1) 장면 전환 시각이 2초 안이면 그 시각으로 옮긴다(모델은 시각을 짐작해 쓴다)
    2) 앞서 남긴 문장(30초 안)을 거의 그대로 담은 문장은 뺀다(level 2·3은 60%, level 1은 85% 이상 겹치면)
    3) level 1부터 남기고 해설 사이를 7초 띄운다. level 1은 5초까지 뒤로 밀고, level 2·3은 자리가 없으면 뺀다"""
    items = []
    for ln in lines:
        ms = min(to_ms(ln["at"]), duration_ms)
        near = min(cuts_ms, key=lambda c: abs(c - ms), default=None)
        if near is not None and abs(near - ms) <= VIDEO_SNAP_MS:
            ms = near
        items.append({**ln, "ms": ms, "said": min(to_ms(ln["at"]), duration_ms)})
    kept: list[dict] = []
    for x in sorted(items, key=lambda x: (x["level"], x["ms"])):
        # level 1끼리는 "라마와 펭귄이 …"처럼 주어가 같아 겹쳐 보이므로 거의 같을 때만 뺀다
        limit = 0.85 if x["level"] == 1 else 0.6
        if any(abs(k["ms"] - x["ms"]) <= 30000 and restates(x["text"], k["text"]) >= limit for k in kept):
            continue
        ms = x["ms"]
        if x["level"] == 1:
            prev = max((k["ms"] for k in kept if k["ms"] <= ms), default=None)
            if prev is not None and ms - prev < VIDEO_MIN_GAP_MS:
                ms = prev + VIDEO_MIN_GAP_MS
                if ms - x["said"] > VIDEO_MAX_SHIFT_MS:  # 모델이 쓴 시각에서 5초 넘게 밀리면 뺀다
                    continue
        if x["level"] == 1:
            if ms >= duration_ms or any(abs(k["ms"] - ms) < VIDEO_MIN_GAP_MS for k in kept):
                continue
        else:
            # 32B는 level 1·2·3을 같은 시각에 겹쳐 쓴다. 빼지 말고 앞 해설을 다 읽은 뒤로 미룬다(8초까지).
            # 4초 간격으로 빼던 때 드라마 원본 27문장이 6문장(2·3은 0)으로 줄었다(2026-11-04)
            ms = free_slot(kept, ms, x["text"])
            if ms is None or ms >= duration_ms:
                continue
        kept.append({**x, "ms": ms})
    return [{k: v for k, v in x.items() if k not in ("ms", "said")} | {"at": mmss_ms(x["ms"])} for x in sorted(kept, key=lambda x: x["ms"])]


def video_copy(playback):
    """32B에 보낼 640px·초당 2장·소리 없는 사본(약 3MB). vLLM이 영상 전체를 정해진 화소 수로 줄이므로 더 크게 보내도 소용없다."""
    out = playback.parent / "video640.mp4"
    if not out.exists():
        local._ff("-i", str(playback), "-vf", "scale=640:-2,fps=2", "-an", "-c:v", "libx264", "-crf", "26",
                   "-preset", "veryfast", str(out))
    return out


VIDEO_CHUNK_MS = int(os.getenv("VIDEO_CHUNK_SEC", "60")) * 1000  # 이보다 길면 약 이 길이 조각으로 나눠 본다.


# vLLM은 영상 길이와 상관없이 정해진 화소 수(약 23,500토큰)로 줄여 보므로, 6분 넘는 영상은 한 장이 너무 작아져 같은 세 문장을
# 끝까지 되풀이했고(라바 6분 35초) 7분 28초 영상은 출력 10,000토큰에서 끊겨 실패했다(브레드이발소). 2분 조각(한 장 448×256)으로도
# 이발소의 쿠키 머리 손님을 분홍 큰머리 주인공으로 착각해 1분으로 줄였다(한 장이 두 배 크게, 2026-11-04)
VIDEO_WHOLE_MAX_MS = VIDEO_CHUNK_MS * 3 // 2  # 조각 하나 반보다 짧으면 통째로(끝에 짧은 조각만 남지 않게)


CHUNK_PROMPT = """
이 영상은 긴 영상의 한 부분입니다(전체 {total} 가운데 {a}~{b}, {k}번째 / {n}개).
- 모든 시각(at, start, end)은 이 부분의 처음을 00:00으로 셉니다. 위 대사·소리 시각도 그렇게 맞춰 두었습니다.
- summary_30s에는 이 부분에서 일어난 일만 2~3문장으로 씁니다.
"""


CHUNK_CONTEXT = """- 앞부분 줄거리: {story}
- 앞부분에서 정한 등장인물(같은 인물은 같은 name·appearance로 부르고, 새 인물만 더합니다):
{cast}
- 화자 번호는 영상 전체에서 같은 목소리에 같은 번호입니다. 앞부분에서 짝지은 화자는 이 부분에서도 같은 인물로 보고
  voices에 다시 적습니다(이 부분에 그 인물이 말하지 않으면 빼도 됩니다). 새로 나온 화자만 새로 짝짓습니다.
"""


def chunk_spans(duration_ms: int) -> list[tuple[int, int]]:
    """약 2분 조각으로 나눈다. 경계는 해설 구간(20초)에 맞추고, 끝에 20초보다 짧은 조각이 남으면 앞 조각에 붙인다."""
    if duration_ms <= VIDEO_WHOLE_MAX_MS:
        return [(0, duration_ms)]
    n = -(-duration_ms // VIDEO_CHUNK_MS)
    step = -(-duration_ms // n // VIDEO_WINDOW_MS) * VIDEO_WINDOW_MS
    spans, a = [], 0
    while a < duration_ms:
        b = min(duration_ms, a + step)
        if duration_ms - b < VIDEO_WINDOW_MS:
            b = duration_ms
        spans.append((a, b))
        a = b
    return spans


def video_part(video, a_ms: int, b_ms: int):
    """640px 사본에서 [a, b) 조각(다시 인코딩: 복사로 자르면 키프레임 때문에 앞이 몇 초 밀린다)."""
    out = video.parent / f"video640_{a_ms}_{b_ms}.mp4"
    if not out.exists():
        local._ff("-ss", f"{a_ms / 1000:.3f}", "-i", str(video), "-t", f"{(b_ms - a_ms) / 1000:.3f}", "-an",
                   "-c:v", "libx264", "-crf", "26", "-preset", "veryfast", str(out))
    return out


# 해설 시각 1.5초 앞부터 8초를 원래 화질로(4초면 해설이 조금 이르게 놓인 비닐랩 장면을 놓쳐 뺐다. 5초면 0:40 해설의 발 장면(0:47)이
# 구간 밖이라 맞는 해설을 뺐다, 데모 2026-11-05)
VERIFY_CLIP_MS = 8000


VERIFY_DIALOGUE_MS = 10000  # 앞뒤 이만큼의 대사를 함께 준다


VERIFY_PROMPT = """화면해설 문장 하나를 검사합니다. 이 영상은 해설 시각 1.5초 앞부터 8초입니다.
등장인물(호칭: 겉모습):
{cast}
앞뒤 대사(받아쓰기. [ ]는 목소리로 짐작한 말한 사람이라 틀릴 수 있음):
{dialogue}
해설: "{text}"

먼저 seen에 이 5초 동안 화면에 누가(겉모습: 색·모양·크기) 무엇을 하는지 그대로 적으세요.
그다음 해설이 seen과 맞는지 판단합니다.
- 해설의 주어 인물이 seen에서 그 행동을 하는 인물과 같은가요? 화면 속 인물의 겉모습이 등장인물 목록의 겉모습과 다르면
  그 호칭을 쓸 수 없습니다. 목록에 없는 인물(손님·지나가는 사람)은 겉모습으로 부릅니다("쿠키 머리 손님").
- 대사 흐름도 함께 봅니다(예: "다 됐습니다", "안녕히 가십시오"는 앞 손님이 머리를 하고 나가는 것).
  [ ] 속 말한 사람이 대사 흐름·화면과 맞지 않으면 대사 흐름·화면을 따릅니다.
verdict
- "ok": 맞거나, 화면만으로 틀렸다고 확신할 수 없을 때.
- "fix": 인물이나 동작이 분명히 틀렸을 때. fixed에 seen에 맞게 고친 문장(현재형 평서문, 30자 이내, 이름·관계(여동생·엄마)를 지어내지 않음).
- "drop": 해설의 일이 이 5초 어디에도 없을 때.
ok·drop이면 fixed는 빈 문자열.
"""


VERIFY_SCHEMA = {"type": "object", "properties": {"seen": {"type": "string", "maxLength": 120},
                                                  "verdict": {"enum": ["ok", "fix", "drop"]},
                                                  "fixed": {"type": "string", "maxLength": 60, "pattern": no_cjk(60)}},
                 "required": ["seen", "verdict", "fixed"], "additionalProperties": False}


def shift_result(r: dict, offset_ms: int) -> dict:
    """조각 결과(merge_level_lines 뒤)의 시각을 영상 전체 기준으로 옮긴다."""
    for x in r.get("lines", []):
        x["at"] = mmss(to_ms(x["at"]) + offset_ms)
    for sc in r.get("scenes", []):
        sc["start"], sc["end"] = mmss(to_ms(sc["start"]) + offset_ms), mmss(to_ms(sc["end"]) + offset_ms)
    return r



# ---------- H200을 부르는 부분(비동기) ----------

async def label_speakers(inf, wav, segs: list[dict]) -> str | None:
    """대사 줄마다 목소리로 나눈 화자 번호를 붙인다(seg["who"] = "화자1"). 서버가 못 하면 붙이지 않는다. 돌려주는 것: 쓴 모델."""
    r = await inf.speakers(wav, segs)
    for s, k in zip(segs, r["speakers"]):
        s["who"] = f"화자{k}"
    return r.get("model") if r["speakers"] else None


async def fix_names(inf, raw: dict, segs: list[dict], voices: dict[str, str], title: str) -> tuple[dict[str, str], str | None]:
    """32B가 지어낸 이름을 고친다(데모 2026-11-04 폭싹 속았수다: 딸 "금명"을 "김금명", 아빠를 "김철수"로).
    - 성+이름 꼴인데 근거가 없으면: 성을 뗀 이름이 제목·대사·화면 글자에 있으면 그 이름으로("김금명" → "금명")
    - 그래도 근거가 없으면 32B에 글로만 물어 대사·겉모습에 맞는 호칭으로("김철수" → "아빠"). "베이커", "빵 이발사" 같은 호칭은 그대로
    해설·장면·요약·말한 사람(segs who, voices)을 모두 바꾼다. 돌려주는 것: {옛 이름: 새 이름}, 물어본 모델."""
    seen = re.sub(r"\s+", "", " ".join([title or ""] + [s["text"] for s in segs]
                                       + [t["text"] for sc in raw["scenes"] for t in sc.get("screen_text", [])]))
    people: dict[str, str] = {}
    for sc in raw["scenes"]:
        for p in sc.get("people", []):
            if p.get("name"):
                people.setdefault(p["name"], p.get("appearance", ""))
    for n in voices.values():
        people.setdefault(n, "")
    renames, unsupported, variants = {}, {}, {}
    for n, look in people.items():
        base = re.sub(r"\s*\(.*\)$", "", n).strip()  # "김성훈(어린 시절)"은 "김성훈"과 같은 사람
        if re.sub(r"\s+", "", base) in seen or not FULL_NAME.fullmatch(base):
            continue
        if base[1:] in seen:
            renames[n] = base[1:]
        else:
            unsupported.setdefault(base, look)
            variants.setdefault(base, []).append(n)
    model = None
    if unsupported:
        schema = {"type": "object", "properties": {"items": {"type": "array", "items": {
            "type": "object", "properties": {"name": {"type": "string"}, "label": {"type": "string", "maxLength": 20}},
            "required": ["name", "label"], "additionalProperties": False}}}, "required": ["items"], "additionalProperties": False}
        prompt = NAME_LABEL_PROMPT.format(people="\n".join(f"  {n}: {a}" for n, a in unsupported.items()),
                                          dialogue="\n".join(f"  {said(s)}" for s in segs[:80]) or "  (없음)")
        try:
            r = await inf.generate_json(prompt, schema, max_tokens=400)
            model = r.get("model")
            for x in r["result"]["items"]:
                label = x.get("label", "").strip()
                if x.get("name") in unsupported and re.fullmatch(r"[가-힣 ]{1,12}", label) and label not in people:
                    for n in variants[x["name"]]:  # 나이별 표기도 같은 호칭으로
                        renames[n] = label
        except (inference.InferenceError, KeyError, TypeError):
            pass
    for old, new in sorted(renames.items(), key=lambda kv: -len(kv[0])):  # 긴 이름("김철수(어린 시절)")부터
        for x in raw["lines"]:
            x["text"] = swap_name(x["text"], old, new)
        for sc in raw["scenes"]:
            sc["title"] = swap_name(sc.get("title", ""), old, new)
            for p in sc.get("people", []):
                if p.get("name") == old:
                    p["name"] = new
                    p["basis"] = "대사에서 부름" if re.sub(r"\s+", "", new) in seen else None
        raw["summary_30s"] = swap_name(raw.get("summary_30s", ""), old, new)
        for v, n in voices.items():
            if n == old:
                voices[v] = new
        for s in segs:
            if s.get("who") == old:
                s["who"] = new
    return renames, model


async def pick_chapters(inf, title: str, lines: list[dict], segs: list[dict], duration_ms: int) -> list[dict]:
    """해설이 다 끝난 뒤 영상 전체의 상세도 1 문장과 대사를 32B에 글로만 보내 메인 장면을 고른다(몇 초).
    조각마다 고르면 조각 경계에서 끊기고 작은 일이 목차가 됐다. 실패하면 빈 목록(장면마다 목차)."""
    lo, hi = chapter_range(duration_ms)
    prompt = CHAPTER_PROMPT.format(
        title=title, dur=mmss(duration_ms), lo=lo, hi=hi,
        lines="\n".join(f"{x['at']} {x['text']}" for x in lines if x["level"] == 1) or "(없음)",
        dialogue="\n".join(f"{mmss(x['startMs'])} {said(x)}" for x in segs) or "(없음)")
    item = {"type": "object", "properties": {"start": {"type": "string", "pattern": "^[0-9]{2}:[0-9]{2}$"},
                                             "title": {"type": "string", "maxLength": 40, "pattern": no_cjk(40)}},
            "required": ["start", "title"], "additionalProperties": False}
    first = {**item, "properties": {**item["properties"], "start": {"const": "00:00"}}}  # 첫 목차는 00:00
    schema = {"type": "object", "properties": {"chapters": {"type": "array", "prefixItems": [first], "items": item,
                                                            "minItems": lo, "maxItems": hi}},
              "required": ["chapters"], "additionalProperties": False}
    try:
        return (await inf.generate_json(prompt, schema, max_tokens=1000))["result"]["chapters"]
    except (inference.InferenceError, KeyError, TypeError):
        return []


async def verify_lines(inf, whole, lines: list[dict], segs: list[dict], scenes: list[dict], duration_ms: int,
                       on_done=None) -> list[dict]:
    """해설 문장(상세도 1·2)마다 그 시각 5초를 원래 화질로 잘라 앞뒤 대사·인물 목록과 함께 32B에 다시 보여 주고, 주어 인물·동작이
    화면과 맞는지 확인한다(맞음/고침/뺌). 영상 전체를 한 번에 보면 한 장이 작아 다른 인물을 주인공으로 착각했다. 돌려주는 것: 검사 기록."""
    seen, people = set(), []
    for sc in scenes:
        for p in sc.get("people", []):
            key = p.get("name") or p.get("appearance")
            if key and key not in seen:
                seen.add(key)
                people.append(f"  {p.get('name') or '(이름 모름)'}: {p.get('appearance', '')}")
    cast = "\n".join(people) or "  (없음)"
    todo = [x for x in lines if x["level"] <= 2]
    gate = asyncio.Semaphore(4)  # 32B vLLM은 4개까지 동시에(--max-num-seqs 4)
    done = 0

    async def one(x: dict) -> dict:
        nonlocal done
        at = to_ms(x["at"])
        a = max(0, at - 1500)
        b = min(duration_ms, a + VERIFY_CLIP_MS)
        near = [s for s in segs if s["endMs"] > at - VERIFY_DIALOGUE_MS and s["startMs"] < at + VERIFY_DIALOGUE_MS]
        dialogue = "\n".join(f"  {mmss(s['startMs'])} {said(s)}" for s in near) or "  (없음)"
        clip = None
        try:
            async with gate:
                clip = await asyncio.to_thread(video_part, whole, a, b)
                r = await inf.describe_video(clip, VERIFY_PROMPT.format(cast=cast, dialogue=dialogue, text=x["text"]), VERIFY_SCHEMA)
            v = r["result"]
            return {"at": x["at"], "text": x["text"], "seen": v.get("seen", ""), "verdict": v["verdict"], "fixed": v.get("fixed", "")}
        except (inference.InferenceError, WorkerError, KeyError, TypeError):
            return {"at": x["at"], "text": x["text"], "verdict": "ok", "fixed": "", "error": True}  # 검사 실패는 그대로 둔다
        finally:
            if clip:
                clip.unlink(missing_ok=True)
            done += 1
            if on_done:
                await on_done(done, len(todo))

    checks = await asyncio.gather(*(one(x) for x in todo))
    for x, c in zip(todo, checks):
        fixed = c["fixed"].strip()
        # 고친 문장에 한자가 섞이거나 너무 길면 고침을 버리고 원래 문장을 둔다
        # 글자 수 상한에 걸려 끝이 잘린 고침("음식을밟")도 쓰지 않는다
        usable = fixed and len(fixed) <= 55 and not re.search(r"[一-鿿぀-ヿ]", fixed) and re.search(r"[다요]\.?$", fixed)
        if c["verdict"] == "fix" and usable and fixed.rstrip(".") != x["text"].rstrip("."):
            x["text"] = fixed.rstrip(".") + "."
        elif c["verdict"] == "fix" and not usable:  # 틀렸다는데 고칠 문장이 없으면 틀린 문장을 두지 않는다
            x["drop"] = True
        elif c["verdict"] == "drop":
            x["drop"] = True
    lines[:] = [x for x in lines if not x.pop("drop", False)]
    return list(checks)


async def describe_video_parts(inf, playback, title: str, segs: list[dict], sound_events: list[dict],
                               duration_ms: int, on_done=None) -> tuple[dict, str, list[dict]]:
    """영상 통째 해설. 길면 1분 조각으로: 첫 조각에서 등장인물·화자 짝을 정하고, 나머지 조각은 그것을 받아 동시에(32B는 3개까지).
    돌려주는 것: Gemini 형식 결과(lines·scenes 시각은 영상 전체 기준), 모델 이름, 조각별 기록."""
    whole = await asyncio.to_thread(video_copy, playback)
    spans = chunk_spans(duration_ms)
    done = 0

    async def one(k: int, context: str = "") -> dict:
        nonlocal done
        a, b = spans[k]
        part = whole if len(spans) == 1 else await asyncio.to_thread(video_part, whole, a, b)
        mine = [{**x, "startMs": max(0, x["startMs"] - a), "endMs": x["endMs"] - a} for x in segs
                if x["startMs"] < b and x["endMs"] > a]
        sounds = [{**e, "startMs": max(0, e["startMs"] - a), "endMs": e["endMs"] - a} for e in sound_events]
        transcript = "\n".join(f"{mmss(x['startMs'])}~{mmss(x['endMs'])} {said(x)}" for x in mine)
        prompt = build_video_prompt(title, sound_lines(sounds, 0, b - a), transcript)
        if len(spans) > 1:
            prompt += CHUNK_PROMPT.format(total=mmss(duration_ms), a=mmss(a), b=mmss(b), k=k + 1, n=len(spans)) + context
        r = await inf.describe_video(part, prompt, video_schema(Narration.model_json_schema(), b - a))
        cast = list(r["result"].get("cast", []))
        out = shift_result(merge_level_lines(r["result"]), a)
        done += 1
        if on_done:
            await on_done(done, len(spans))
        return {"span": [a, b], "prompt": prompt, "result": out, "cast": cast, "model": r.get("model", inf.name)}

    first = await one(0)
    if len(spans) == 1:
        return first["result"], first["model"], [first]
    # 첫 조각의 화자 짝도 넘긴다. 안 넘기면 조각마다 다르게 짝지었다(화자3을 큰머리 컵케이크 → 컵케이크 아이)
    cast = "\n".join(f"  {c.get('name') or '(이름 모름)'}: {c.get('appearance', '')}"
                     + (f" (목소리: {', '.join(c['voices'])})" if c.get("voices") else "") for c in first["cast"]) or "  (없음)"
    context = CHUNK_CONTEXT.format(story=first["result"].get("summary_30s", ""), cast=cast)
    gate = asyncio.Semaphore(3)

    async def later(k: int) -> dict:
        async with gate:
            return await one(k, context)
    parts = [first] + list(await asyncio.gather(*(later(k) for k in range(1, len(spans)))))
    merged = {"category": first["result"].get("category", "기타"), "dialogue": [],
              "scenes": [sc for p in parts for sc in p["result"]["scenes"]],
              "lines": [x for p in parts for x in p["result"]["lines"]],
              "summary_30s": " ".join(p["result"].get("summary_30s", "") for p in parts)}
    # 인물: 조각마다 cast가 그 조각 첫 장면 people에 들어가 있다(merge_level_lines). 저장할 때 이름 기준으로 모인다
    # 30초 요약: 조각 요약을 이어 붙이면 길어서 글만으로 한 번 더 줄인다(H200, 크레딧 0)
    try:
        summ = await inf.summarize({"title": title, "transcript": " ".join(x["text"] for x in segs),
                                    "sceneTitles": [sc["title"] for sc in merged["scenes"]],
                                    "lines": [p["result"].get("summary_30s", "") for p in parts]})
        merged["summary_30s"] = summ.get("summary") or merged["summary_30s"]
    except inference.InferenceError:
        pass
    return merged, f"{first['model']} ({len(parts)}조각)", parts


async def analyze_situation(inf, title: str | None, files: dict, work, duration_ms: int, progress,
                            gms=None, job_id: int | None = None) -> tuple[dict, str]:
    """업로드 영상 파이프라인(상황 먼저, situation.py): 듣기 → 얼굴로 사람 묶기 → 본 일 기록 → 대사마다 말한 사람 →
    호칭·상황 흐름·목차 → 해설 대본 → 끼워 넣기·검사. 이름은 쓰지 않고 성별+겉모습 호칭(같은 사람은 같은 호칭).
    progress(pct)는 PREPARE 구간(6~18) 안에서 실제로 끝낸 만큼 올린다: 7 받아쓰기 · 8 소리·화자·얼굴 · 8~11 영상 보기 ·
    12 말한 사람 · 13 호칭 · 14 상황 흐름 · 16 대본 · 16~18 검사. 상황 흐름과 대본은 H200을 한 번씩 길게 불러 합쳐 전체의
    약 4분의 1이 걸려서, 그 사이에도 진행률이 오르게 값을 따로 둔다."""
    from app.pipeline import situation as st
    title = title or ""
    playback, wav = files["playback"], files["wav"]
    await progress(6)
    stt = await inf.transcribe(wav)
    language = stt.get("language")
    segs = await translate_segments(inf, stt["segments"], language, title, gms, job_id)
    await progress(7)
    sound_events = (await inf.sounds(wav)).get("events", [])
    await label_speakers(inf, wav, segs)  # 목소리로 나눈 "화자1, 화자2…"(WeSpeaker)
    faces = await st.find_faces(inf, playback)  # 얼굴로 같은 사람끼리 P1, P2…(H200 /faces, CPU)
    copy = await asyncio.to_thread(video_copy, playback)
    video = await asyncio.to_thread(st.label_video, copy, faces) if faces["persons"] else copy
    guide, _ = genre_guide(title, characters=False)  # 이름을 쓰지 않아 시리즈 등장인물 사전도 넣지 않는다
    await progress(8)

    async def looked(d: int, t: int) -> None:
        await progress(8 + 3 * d // t)
    look, parts = await st.look_parts(inf, video, title, segs, sound_events, duration_ms, faces, guide, looked)
    await asyncio.to_thread(st.voice_gender, wav, segs)  # 줄마다 목소리 높이로 남녀
    await st.attribute_speakers(inf, title, look, faces, segs)
    body_fixes = st.fix_injury_owners(look)  # 얼굴 없이 보인 다친 곳(발목)의 주인을 영상 전체 기록의 다수로
    await progress(12)
    sit = await st.understand(inf, title, duration_ms, look, faces, segs, guide, labelled=lambda: progress(13))
    await progress(14)
    calls = {p["id"]: p["call"] for p in sit["people"]}
    for x in segs:  # 말한 사람: 번호 → 호칭(같은 사람으로 합친 번호도). 못 정한 줄은 비운다
        x["name"] = calls.get(sit["canon"].get(x.get("pid"), x.get("pid")))
        x["who"] = x["name"]

    async def wrote(d: int, t: int) -> None:
        await progress(14 + 2 * d // t)
    lines = await st.write_script(inf, title, duration_ms, sit, look, segs, calls, wrote)
    owners = look.get("injury_owner", {})
    for x in sit["situations"]:  # 다친 곳 주인을 상황 흐름·목차·요약 글에도 맞춘다
        x["title"], x["what"] = st.fix_injury_text(x["title"], calls, owners), st.fix_injury_text(x["what"], calls, owners)
    for c in sit["chapters"]:
        c["title"] = st.fix_injury_text(c["title"], calls, owners)
    sit["summary"] = st.fix_injury_text(sit["summary"], calls, owners)
    text_notes = st.clean_screen_texts(look, segs, duration_ms)  # 계속 떠 있는 로고는 한 번만, 대사 받아쓴 자막은 읽지 않게
    raw = st.to_narration(sit, look, faces, calls, duration_ms)
    log.info("상황 먼저: 얼굴 %d명, 본 일 %d, 대본 %d문장, 호칭 고침 %s, 다친 곳 %s, 화면 글자 %s", len(faces["persons"]),
             len(look["seen"]), len(lines), sit.get("label_fixes"), body_fixes, text_notes)
    lines = [{**x, "text": t} for x in lines for t in split_compound(x["text"], x["level"])]
    lines = [x for x in lines if not (x["level"] > 1 and TINY_DETAIL.search(x["text"]))]
    lines = drop_repeated_actions(drop_said(sorted(lines, key=lambda x: (to_ms(x["at"]), x["level"])), segs))
    cuts = await asyncio.to_thread(scene_cuts, playback)
    raw["lines"] = tidy_video_lines(lines, cuts, duration_ms)
    if os.getenv("VERIFY_LINES", "on") != "off":
        cast = [{"people": [{"name": p["call"], "appearance": look["cast"].get(p["id"], {}).get("look", "")
                             + (f" (얼굴 번호표 {p['id']})" if p["id"].startswith("P") else "")} for p in sit["people"]]}]

        async def checked(d: int, t: int) -> None:
            await progress(16 + 2 * d // t)
        await verify_lines(inf, video, raw["lines"], segs, cast, duration_ms, checked)
        for x in raw["lines"]:  # 검사가 고친 문장의 번호(P5)를 호칭으로, 다친 곳 주인도 다시 맞춤
            x["text"] = st.fix_injury_text(st.clean_ids(x["text"], calls), calls, owners)
    await progress(18)
    if not raw["chapters"]:
        raw["chapters"] = await pick_chapters(inf, title, raw["lines"], segs, duration_ms)
    raw["voice_names"] = sorted({x["name"] for x in segs if x.get("name")})
    raw["dialogue"] = [{"start": mmss_ms(x["startMs"]), "end": mmss_ms(x["endMs"]), "speaker": x.get("name"), "text": x["text"],
                        "original": x.get("original")} for x in segs]
    raw["dialogue_language"] = language if any(x.get("original") for x in segs) else None
    korean_only(raw)
    try:
        Narration.model_validate(raw)
    except ValueError as e:
        raise inference.InferenceError("INFER_FAILED", f"상황 먼저 해설 형식이 맞지 않아요: {str(e)[:120]}") from None
    return raw, f"local-video:{parts[0]['model']} (상황 먼저)"


async def analyze_video(inf, title: str | None, files: dict, work, duration_ms: int, progress,
                        gms=None, job_id: int | None = None) -> tuple[dict, str]:
    """32B 영상 보기 경로: 받아쓰기·소리·화자(H200) → 32B 1분 조각 해설 → 이름 고치기 → 정리 → 화면 검사 → 메인 장면 목차.
    UPLOAD_FLOW=old가 아니면 상황 먼저(analyze_situation, 업로드 영상 파이프라인).
    progress(pct)는 PREPARE 구간(6~18) 안에서 실제로 끝낸 만큼 올린다."""
    if os.getenv("UPLOAD_FLOW", "situation") != "old" and inf.name != "mock":
        return await analyze_situation(inf, title, files, work, duration_ms, progress, gms, job_id)
    title = title or ""
    playback, wav = files["playback"], files["wav"]
    await progress(6)
    stt = await inf.transcribe(wav)
    language = stt.get("language")
    segs = await translate_segments(inf, stt["segments"], language, title, gms, job_id)
    await progress(8)
    sound_events = (await inf.sounds(wav)).get("events", [])
    await label_speakers(inf, wav, segs)  # 목소리로 나눈 "화자1, 화자2…"
    await progress(9)

    async def parts_done(d: int, t: int) -> None:
        await progress(9 + 6 * d // t)
    raw, model, parts = await describe_video_parts(inf, playback, title, segs, sound_events, duration_ms, parts_done)
    voices = match_voices([p["cast"] for p in parts], segs)  # 화자 번호 → 인물 이름(32B가 cast.voices에 적은 짝)
    await fix_names(inf, raw, segs, voices, title)  # 지어낸 이름 고치기(김금명 → 금명, 김철수 → 아빠)
    raw = json.loads(json.dumps(raw))
    dedupe_screen_texts(raw["scenes"])
    mark_dialogue_subtitles(raw["scenes"], segs)
    for s in raw["scenes"]:  # "남성"·"여성"을 이름 자리에 쓴 것은 이름이 아니다
        for person in s.get("people", []):
            if person.get("name") and NOT_A_NAME.fullmatch(person["name"].strip()):
                person["name"], person["basis"] = None, None
    unbracket_names(raw)  # "금명(어린 시절)이" → "어린 시절, 금명이"(읽을 때 괄호가 어색함)
    lines = [{**x, "text": t} for x in raw["lines"] for t in split_compound(x["text"], x["level"])]
    lines = [x for x in lines if not (x["level"] > 1 and TINY_DETAIL.search(x["text"]))]
    # 빼기(대사 되풀이·같은 동작)를 먼저 하고 자리 잡기를 나중에(거꾸로 하면 1분이 통째로 빈 적이 있음)
    lines = drop_repeated_actions(drop_said(sorted(lines, key=lambda x: (to_ms(x["at"]), x["level"])), segs))
    cuts = await asyncio.to_thread(scene_cuts, playback)
    raw["lines"] = tidy_video_lines(lines, cuts, duration_ms)
    if os.getenv("VERIFY_LINES", "on") != "off":

        async def checked(d: int, t: int) -> None:
            await progress(15 + 2 * d // t)
        await verify_lines(inf, await asyncio.to_thread(video_copy, playback), raw["lines"], segs, raw["scenes"],
                           duration_ms, checked)
    await progress(18)
    raw["chapters"] = await pick_chapters(inf, title, raw["lines"], segs, duration_ms)
    # 말한 사람: 인물 이름으로 맞춘 줄만(화자 번호뿐인 줄은 비움). 목소리로 짝지은 호칭은 저장할 때 인물로 남긴다(merge)
    names = set(voices.values())
    raw["voice_names"] = sorted(names)
    raw["dialogue"] = [{"start": mmss_ms(x["startMs"]), "end": mmss_ms(x["endMs"]),
                        "speaker": x.get("who") if x.get("who") in names else None, "text": x["text"],
                        "original": x.get("original")} for x in segs]
    raw["dialogue_language"] = language if any(x.get("original") for x in segs) else None
    korean_only(raw)  # 한자·가나 거름(옛 방식에도)
    try:
        Narration.model_validate(raw)
    except ValueError as e:
        raise inference.InferenceError("INFER_FAILED", f"영상 보기 해설 형식이 맞지 않아요: {str(e)[:120]}") from None
    return raw, f"local-video:{model}"
