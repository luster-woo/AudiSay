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
