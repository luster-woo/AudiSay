"""외국어 대사 낭독 목소리 배역 (2026-11-11 사용자 결정: 말머리 "태웅: " 없이 목소리로만 인물을 구별한다).

번역 문장(describe.dub_lines)마다 Gemini가 준 말한 사람·성별·나이대로, 인물 하나에 Gemini TTS 목소리 하나를 영상 끝까지 고정한다.
- 대사가 많은 인물(주인공)부터 그 성별·나이대 후보 중 아직 안 쓴 목소리를 먼저 받는다 → 주요 인물끼리 겹치지 않는다
- 후보를 다 쓰면 그 후보 중 가장 덜 쓴 목소리를 같이 쓴다
- 해설 목소리(Kore)는 후보에 넣지 않는다 → 해설과 대사가 늘 구별된다
- 성별을 모르면 tts.DUB_VOICE(Charon). 이름 모르는 사람은 성별·나이대가 같으면 한 사람으로 본다
후보 목소리는 모두 GMS로 한국어 문장을 불러 확인했다(2026-11-11). 결과 {line_index: 목소리}는 merge가 jobs/{jobId}/voices.json에 남기고 TTS가 읽는다.
"""
from collections import Counter

DEFAULT_VOICE = "Charon"  # tts.DUB_VOICE와 같다(순환 import를 피해 여기 둔다)
AGES = ("child", "teen", "young", "middle", "senior")
POOLS: dict[tuple[str, str], list[str]] = {
    ("male", "child"): ["Puck", "Sadachbia", "Zubenelgenubi"],
    ("male", "teen"): ["Puck", "Sadachbia", "Zubenelgenubi"],
    ("male", "young"): ["Puck", "Achird", "Umbriel", "Zubenelgenubi", "Iapetus"],
    ("male", "middle"): ["Charon", "Orus", "Rasalgethi", "Iapetus", "Alnilam"],
    ("male", "senior"): ["Algenib", "Schedar", "Alnilam", "Charon"],
    ("female", "child"): ["Leda", "Laomedeia", "Autonoe"],
    ("female", "teen"): ["Leda", "Laomedeia", "Autonoe"],
    ("female", "young"): ["Aoede", "Zephyr", "Autonoe", "Laomedeia"],
    ("female", "middle"): ["Despina", "Erinome", "Callirrhoe", "Sulafat"],
    ("female", "senior"): ["Gacrux", "Vindemiatrix", "Sulafat"],
}


# 직접 올린 영상(Supertonic 3): 해설 목소리 F1(수아)은 빼고 성별마다 목소리를 돌려 쓴다. 나이대 목소리는 따로 없다(2026-11-16)
SUPERTONIC_FEMALE = ["F2", "F3", "F4", "F5"]
SUPERTONIC_MALE = ["M1", "M2", "M3", "M4", "M5"]
SUPERTONIC_POOLS: dict[tuple[str, str], list[str]] = {
    (g, a): SUPERTONIC_MALE if g == "male" else SUPERTONIC_FEMALE for g in ("male", "female") for a in AGES}
SUPERTONIC_DEFAULT = "M3"  # 성별을 모를 때. 해설(F1, 여성)과 확실히 다르게
SUPERTONIC_VOICES = {"F1", *SUPERTONIC_FEMALE, *SUPERTONIC_MALE}


def voices_key(job_id: int) -> str:
    """merge가 남기는 목소리 배역 {"lineIndex": 목소리}. TTS(job.tts·line.tts)가 descriptions.job_id로 찾아 읽는다."""
    return f"jobs/{job_id}/voices.json"


def _gender(v: str | None) -> str | None:
    v = (v or "").strip().lower()
    return "male" if v in ("male", "m", "남", "남성", "man") else "female" if v in ("female", "f", "여", "여성", "woman") else None


def _age(v: str | None) -> str:
    v = (v or "").strip().lower()
    return v if v in AGES else "middle"  # 나이대를 모르면 어른 목소리


def cast(lines: list[dict], dub_flag: str, pools: dict[tuple[str, str], list[str]] | None = None,
         default: str = DEFAULT_VOICE) -> dict[int, str]:
    """lines: merge의 문장(lineIndex·flags, 번역 문장은 speaker·gender·age). 반환 {lineIndex: 목소리}(번역 문장만).
    pools·default: 직접 올린 영상은 SUPERTONIC_POOLS·SUPERTONIC_DEFAULT(Supertonic 목소리), 유튜브는 기본(Gemini 목소리)."""
    pools = pools or POOLS
    dubs = [x for x in lines if dub_flag in (x.get("flags") or [])]
    if not dubs:
        return {}

    def who(x: dict) -> str:
        return x.get("speaker") or f"?{_gender(x.get('gender'))}/{_age(x.get('age'))}"

    by_person: dict[str, list[dict]] = {}
    for x in dubs:
        by_person.setdefault(who(x), []).append(x)
    used: Counter[str] = Counter()
    voice_of: dict[str, str] = {}
    for person, xs in sorted(by_person.items(), key=lambda kv: -len(kv[1])):  # 대사가 많은 인물부터
        gender = Counter(g for g in (_gender(x.get("gender")) for x in xs) if g).most_common(1)
        if not gender:
            voice_of[person] = default
            continue
        age = Counter(_age(x.get("age")) for x in xs).most_common(1)[0][0]
        pool = pools[(gender[0][0], age)]
        voice = next((v for v in pool if not used[v]), None) or min(pool, key=lambda v: used[v])
        used[voice] += 1
        voice_of[person] = voice
    return {x["lineIndex"]: voice_of[who(x)] for x in dubs}
