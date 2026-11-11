"""job.merge 순수 부분: 이름 근거 규칙, 목차 키워드, full.json + chunks → 저장할 행(assemble)."""
from app.pipeline.keywords import extract
from app.pipeline.merge import assemble, name_source, trusted_name


def test_trusted_name_accepts_only_evidence():
    assert trusted_name("치이카와", "이름 자막") == "치이카와"
    assert trusted_name("하치와레", "대사에서 하치와레라고 부름") == "하치와레"
    assert trusted_name("우사기", "엔딩 크레딧") == "우사기"
    assert trusted_name("모몽가", "시리즈 등장인물 사전과 겉모습 일치") == "모몽가"
    # 걸러지는 예(데모 실제 데이터): 배경지식·목소리·외형
    assert trusted_name("김철수", "외형") is None
    assert trusted_name("김철수", "대사 속 목소리") is None
    assert trusted_name("김철수", None) is None
    assert trusted_name(None, "이름 자막") is None


def test_name_source_codes():
    assert name_source("이름 자막") == "SCREEN_TEXT"
    assert name_source("대사에서 부름") == "DIALOGUE"
    assert name_source("시리즈 등장인물 사전") == "AI"
    assert name_source(None) is None


def test_keywords_strip_josa_and_verbs():
    ks = extract("치즈밥 만들기", ["치즈를 밥 위에 올립니다", "치즈가 녹습니다", "프라이팬을 달굽니다"])
    assert ks[0] == "치즈밥"
    assert "치즈" in ks and "프라이팬" in ks
    assert not any(k.endswith("니다") for k in ks)
    assert len(ks) <= 6


FULL = {
    "durationMs": 60_000, "category": "ENTERTAINMENT", "summary30s": "요약", "model": "gemini-3.8-flash",
    "dialogues": [{"startMs": 1000, "endMs": 3000, "speaker": "치이카와 (작은 목소리)", "text": "안녕"},
                  {"startMs": 40_000, "endMs": 70_000, "speaker": None, "text": "끝"}],
    "scenes": [
        {"startMs": 0, "endMs": 30_000, "title": "숲길 산책",
         "people": [{"name": "치이카와", "basis": "이름 자막", "appearance": "흰 몸"},
                    {"name": "김철수", "basis": "외형", "appearance": "파란 모자"}],
         "screenTexts": []},
        {"startMs": 25_000, "endMs": 60_000, "title": "엔딩 크레딧", "people": [], "screenTexts": []},
    ],
    "lines": [],
}
CHUNKS = [
    {"chunkIndex": 1, "lines": [{"detailLevel": 1, "startMs": 35_000, "gapEndMs": 40_000, "importance": 3, "text": "자막이 올라갑니다", "flags": []}],
     "screenTexts": [{"startMs": 25_000, "endMs": 60_000, "textType": "TITLE", "importance": "HIGH", "fullText": "끝", "sameAsDialogue": False}]},
    {"chunkIndex": 0, "lines": [{"detailLevel": 2, "startMs": 5000, "gapEndMs": None, "importance": 2, "text": "흰 생물이 숲길을 걷습니다", "flags": []},
                                {"detailLevel": 1, "startMs": 3000, "gapEndMs": 4000, "importance": 3, "text": "숲길입니다", "flags": ["TOO_LONG"]},
                                {"detailLevel": 1, "startMs": 6000, "gapEndMs": None, "importance": 3, "text": "   ", "flags": []}],
     "screenTexts": []},
]


def test_assemble_rows():
    plan = assemble(FULL, CHUNKS)
    # 인물: 근거 있는 이름만, 없는 이름은 dropped
    assert [c["name"] for c in plan.characters] == ["치이카와"]
    assert plan.characters[0]["nameSource"] == "SCREEN_TEXT"
    assert plan.dropped_names == ["김철수"]
    # 대사: 말한 사람 괄호 제거, 영상 길이로 자름
    assert plan.dialogues[0]["speaker"] == "치이카와"
    assert plan.dialogues[1]["endMs"] == 60_000 and plan.dialogues[1]["speaker"] is None
    # 문장: 빈 문장 제외, 조각 순서와 무관하게 시각 순, 번호 1부터
    assert [x["text"] for x in plan.lines] == ["숲길입니다", "흰 생물이 숲길을 걷습니다", "자막이 올라갑니다"]
    assert [x["lineIndex"] for x in plan.lines] == [1, 2, 3]
    assert plan.lines[0]["flags"] == ["TOO_LONG"]
    # 장면: 겹치지 않게 앞 장면 끝부터, 이름 모르는 인물은 겉모습으로
    assert [(s["startMs"], s["endMs"]) for s in plan.scenes] == [(0, 30_000), (30_000, 60_000)]
    assert "치이카와(흰 몸)" in plan.scenes[0]["sceneDescription"]
    assert "이름 모르는 인물(파란 모자)" in plan.scenes[0]["sceneDescription"]
    assert plan.scenes[1]["sceneDescription"].startswith("자막이 올라갑니다")
    # 목차: 요약은 상세도 1·2 문장, 키워드는 제목 낱말부터
    assert plan.chapters[1]["keywords"][:2] == ["엔딩", "크레딧"]
    assert plan.chapters[0]["summary"] == "숲길입니다 흰 생물이 숲길을 걷습니다"
    # 화면 글자
    assert plan.screen_texts == [{"startMs": 25_000, "endMs": 60_000, "textType": "TITLE", "importance": "HIGH",
                                  "fullText": "끝", "sameAsDialogue": False}]


def test_assemble_partial_stops_at_covered_until():
    """조각 1이 실패해 BE가 succeededChunks=[0], coveredUntilMs=30000을 보낸 경우: 30초까지만 저장."""
    plan = assemble(FULL, [CHUNKS[1]], covered_until_ms=30_000, model="gemini-3.5-flash")
    assert plan.model == "gemini-3.5-flash"  # BE modelName(null) 대신 prepare.json의 모델
    assert [x["text"] for x in plan.lines] == ["숲길입니다", "흰 생물이 숲길을 걷습니다"]
    assert [(s["startMs"], s["endMs"]) for s in plan.scenes] == [(0, 30_000)]  # 두 번째 장면(25~60초)은 0길이 → 제외
    assert len(plan.dialogues) == 1 and plan.dialogues[0]["text"] == "안녕"  # 40초 대사는 범위 밖
    assert plan.screen_texts == []


def test_name_must_appear_in_title_dialogue_or_screen():
    """근거라고 적었어도 제목·대사·화면 글자에 없는 이름은 뺀다(2026-11-03 데모: 프롬프트 예시 이름이 드라마 상대역으로 나옴).
    대사에서 언급한 이름은 인정한다. 제목이 없는 예전 full.json은 이 확인을 건너뛴다."""
    full = {**FULL, "title": "김유정X박진영의 첫 회식",
            "dialogues": [{"startMs": 1000, "endMs": 3000, "speaker": None, "text": "사토 히데오의 마음을 얻어라"}],
            "scenes": [{"startMs": 0, "endMs": 60_000, "title": "재즈 클럽", "screenTexts": [],
                        "people": [{"name": "박진영", "basis": "영상 제목", "appearance": "코트"},
                                   {"name": "최유리", "basis": "영상 제목", "appearance": "원피스"},
                                   {"name": "사토 히데오", "basis": "대사에서 '사토 히데오의 마음을 얻어라' 언급", "appearance": "제복"}]}]}
    chunks = [{"chunkIndex": 0, "screenTexts": [],
               "lines": [{"detailLevel": 1, "startMs": 5000, "gapEndMs": None, "importance": 3, "text": "최유리가 맥주를 건넨다.", "flags": []}]}]
    plan = assemble(full, chunks)
    assert [c["name"] for c in plan.characters] == ["박진영", "사토 히데오"]
    assert plan.dropped_names == ["최유리"]
    assert plan.lines[0]["text"] == "원피스가 맥주를 건넨다."  # 근거 없는 이름은 겉모습 호칭으로 바꿔 읽는다
    # 장면 설명의 '등장'에도 근거 없는 이름을 쓰지 않는다
    assert "최유리" not in plan.scenes[0]["sceneDescription"]
    assert "이름 모르는 인물(원피스)" in plan.scenes[0]["sceneDescription"]
    old = assemble({**full, "title": None}, chunks)  # 제목 모르면 예전처럼 근거 말만 본다
    assert [c["name"] for c in old.characters] == ["박진영", "최유리", "사토 히데오"]


def test_made_up_names_become_label_or_subtitle_name():
    """2026-11-10 '100일의 거짓말': 자막엔 '가경'뿐인데 '금가경', 영상에 없는 '임승묵(박성웅)'을 지어 첫 해설에서 읽었다.
    성을 뗀 이름이 자막에 있으면 그것으로, 아예 없으면 겉모습 호칭으로 바꾸고 조사도 맞춘다. 배우 괄호는 떼고 본다."""
    full = {**FULL, "title": "마지막으로 꼭 전하고 싶었던 가경의 진심 아무것도 모르는 태웅",
            "dialogues": [{"startMs": 1000, "endMs": 3000, "speaker": "임승묵(박성웅)", "text": "유모 이름은 금서희야"},
                          {"startMs": 4000, "endMs": 5000, "speaker": "김태웅(진영)", "text": "김태웅이 아니라"}],
            "scenes": [{"startMs": 0, "endMs": 60_000, "title": "떠나는 가경", "screenTexts": [],
                        "people": [{"name": "금가경(김유정)", "basis": "자막", "appearance": "브라운 재킷 여성"},
                                   {"name": "임승묵(박성웅)", "basis": "대사 및 자막", "appearance": "회색 원피스를 입은 중년 여성"},
                                   {"name": "김태웅(진영)", "basis": "대사에서 언급", "appearance": "검은 수트"}]}]}
    line = lambda t, s: {"detailLevel": 1, "startMs": s, "gapEndMs": None, "importance": 3, "text": t, "flags": []}
    chunks = [{"chunkIndex": 0, "screenTexts": [], "lines": [line("임승묵과 금가경이 마주 앉는다.", 0),
                                                             line("승묵이 부품을 조립한다.", 10_000),
                                                             line("김태웅의 얼굴이 굳는다.", 20_000)]}]
    plan = assemble(full, chunks)
    assert [x["text"] for x in plan.lines] == ["원피스를 입은 중년 여성과 가경이 마주 앉는다.",  # 15자 안으로 앞 낱말을 뗌
                                               "원피스를 입은 중년 여성이 부품을 조립한다.", "김태웅의 얼굴이 굳는다."]
    assert [c["name"] for c in plan.characters] == ["가경", "김태웅"]
    assert [d["speaker"] for d in plan.dialogues] == [None, "김태웅"]


def test_check_flags_prompt_v4_rules():
    """프롬프트 v4 점검 항목을 코드로: 쓰지 않는 표현, 대명사, 상세도별 글자 수(2026-11-03)."""
    from app.pipeline.describe import check

    assert "BANNED_PHRASE" in check("두 사람이 노래하는 모습이 보입니다.", 0, [], 1)
    assert "PRONOUN" in check("그녀가 마이크 앞에 앉는다.", 0, [], 2)
    assert "OVER_LEVEL_LENGTH" in check("가" * 31, 0, [], 1)
    assert check("최유리가 마이크 앞에 앉는다.", 0, [], 1) == []


def test_dub_line_keeps_translation_and_only_fixes_speaker():
    """외국어 대사 낭독 문장의 번역 글은 대사(transcript_segments)와 같아야 BE 챗봇(DubLines)이 대사로 알아보고 화면 해설에서 뺀다.
    그래서 근거 없는 이름은 앞의 말한 사람만 고치고 번역 글은 건드리지 않는다."""
    full = {**FULL, "title": "가경의 진심",
            "dialogues": [{"startMs": 1000, "endMs": 3000, "speaker": "임승묵(박성웅)", "text": "승묵 씨 왔어요", "dub": True},
                          {"startMs": 4000, "endMs": 5000, "speaker": None, "text": "어서 와요"},  # 한국어 대사가 더 많은 영상
                          {"startMs": 6000, "endMs": 7000, "speaker": None, "text": "앉으세요"}],
            "scenes": [{"startMs": 0, "endMs": 60_000, "title": "가경", "screenTexts": [],
                        "people": [{"name": "금가경", "basis": "자막", "appearance": "재킷"},
                                   {"name": "임승묵(박성웅)", "basis": "자막", "appearance": "중년 여성"}]}]}
    dub = lambda t: {"detailLevel": 1, "startMs": 1000, "gapEndMs": None, "importance": 3, "text": t, "flags": ["DIALOGUE_DUB"]}
    plan = assemble(full, [{"chunkIndex": 0, "screenTexts": [], "lines": [dub("임승묵: 승묵 씨 왔어요"), dub("금가경: 가자")]}])
    assert [x["text"] for x in plan.lines] == ["승묵: 승묵 씨 왔어요", "가경: 가자"]
    assert plan.lines[0]["text"].partition(": ")[2] == plan.dialogues[0]["text"]  # 번역 글은 대사와 같게


def test_foreign_video_keeps_transliterated_names():
    """대사가 대부분 외국어면(번역 낭독) 한글로 옮긴 이름(Mitchell → 미첼)을 제목·대사와 맞춰 보지 않는다(2026-11-11 모던 패밀리)."""
    full = {**FULL, "title": "Modern Family | Lily Goes to a Vietnamese Restaurant",
            "dialogues": [{"startMs": 1000, "endMs": 3000, "speaker": "미첼", "text": "맛있다", "original": "So good", "dub": True}],
            "scenes": [{"startMs": 0, "endMs": 60_000, "title": "식당", "screenTexts": [],
                        "people": [{"name": "미첼", "basis": "대사 속 호명", "appearance": "남성, 검은색 긴팔 옷 착용"}]}]}
    line = {"detailLevel": 1, "startMs": 5000, "gapEndMs": None, "importance": 3, "text": "미첼이 박수를 친다.", "flags": []}
    plan = assemble(full, [{"chunkIndex": 0, "screenTexts": [], "lines": [line]}])
    assert [c["name"] for c in plan.characters] == ["미첼"] and plan.lines[0]["text"] == "미첼이 박수를 친다."
