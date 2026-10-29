"""재생 중 말 분석의 규칙 부분(AI 없이): 발화 분석, 키워드로 장면 찾기, 답변 문장 나누기."""
from app.chat import answer as ans
from app.chat import seek as sk
from app.chat.intent import by_rules

DUR = 600_000  # 10분


def test_seek_time_absolute():
    assert by_rules("3분 20초로 가줘", DUR).targetMs == 200_000
    assert by_rules("1:05", DUR).intent == "SEEK_TIME"
    assert by_rules("처음부터", DUR).targetMs == 0
    assert by_rules("마지막으로 가", DUR).targetMs == DUR - 3000
    assert by_rules("90분으로 가줘", DUR).targetMs == DUR  # 영상 길이로 자름
    assert by_rules("90분으로 가줘", 0).targetMs == 5_400_000  # 길이를 모르면(descriptionId 없음) 자르지 않음
    assert by_rules("마지막으로", 0).targetMs is None


def test_seek_time_relative_uses_now():
    p = by_rules("5초 뒤로 가줘", DUR, now_ms=10_000)  # '뒤로' = 나중으로 넘기기
    assert (p.intent, p.targetMs, p.relativeMs) == ("SEEK_TIME", 15_000, 5000)
    p = by_rules("30초 전으로", DUR, now_ms=10_000)
    assert (p.targetMs, p.relativeMs) == (0, -30_000)


def test_settings():
    assert by_rules("상세도 최대로", DUR).setting == {"detailLevel": 3}
    assert by_rules("간단히 해설해 줘", DUR).setting == {"detailLevel": 1}
    assert by_rules("말하기 속도 1.5배", DUR).setting == {"speechRate": 1.5}
    assert by_rules("천천히 읽어", DUR).setting == {"speechRate": 0.75}
    assert by_rules("자막 읽지 마", DUR).setting == {"subtitleReading": "OFF"}


def test_actions_and_scene_now():
    assert by_rules("멈춰", DUR).action == "PAUSE"
    assert by_rules("재생해 줘", DUR).action == "PLAY"
    assert by_rules("지금 어디쯤이야?", DUR).action == "WHERE"
    assert by_rules("요약 들려줘", DUR).action == "SUMMARY"
    assert by_rules("지금 장면 설명해 줘", DUR).intent == "SCENE_NOW"


def test_seek_scene_and_questions():
    p = by_rules("엔딩크레딧으로 가줘", DUR)
    assert (p.intent, p.sceneQuery) == ("SEEK_SCENE", "엔딩크레딧으로 가줘")
    assert by_rules("요리하는 장면 보여줘", DUR).intent == "SEEK_SCENE"
    assert by_rules("갑옷 씨는 어디로 들어왔어?", DUR).intent == "QUESTION"  # '어디'가 있지만 위치 질문이 아니다
    assert by_rules("치즈밥 레시피 알려줘", DUR).intent == "QUESTION"
    assert by_rules("", DUR).intent == "UNKNOWN"
    assert by_rules("음 그러니까", DUR) is None  # 모르면 AI에게


CHAPTERS = [
    {"chapterId": 1, "startMs": 0, "endMs": 30_000, "title": "숲길 산책", "summary": "흰 생물이 걷습니다", "keywords": ["숲길", "산책"]},
    {"chapterId": 2, "startMs": 30_000, "endMs": 60_000, "title": "치즈밥 만들기", "summary": "치즈를 올립니다", "keywords": ["치즈밥"]},
    {"chapterId": 3, "startMs": 60_000, "endMs": 90_000, "title": "엔딩 크레딧", "summary": None, "keywords": ["엔딩", "크레딧"]},
]


def test_seek_by_keywords_scores_title_over_summary():
    c = sk.by_keywords("치즈밥 만드는 장면으로 가줘", CHAPTERS)
    assert c[0]["chapterId"] == 2 and c[0]["score"] >= 3
    assert sk.pick(c)["chapterId"] == 2
    assert sk.by_keywords("엔딩크레딧으로", CHAPTERS)[0]["chapterId"] == 3  # 띄어쓰기 차이
    assert sk.by_keywords("가줘", CHAPTERS) == []  # 뜻 있는 낱말이 없다
    # 요약에만 있는 낱말은 1점
    assert sk.by_keywords("치즈 나오는 데로", CHAPTERS)[0]["chapterId"] == 2


def test_spoken_ms_and_far_scene_hint():
    assert sk.spoken_ms(200_000) == "3분 20초"
    assert sk.spoken_ms(40_000) == "40초"
    assert sk.spoken_ms(120_000) == "2분"
    hint = sk.far_scene_hint("치즈밥은 어떻게 만들어?", CHAPTERS, now_ms=5000)
    assert hint.startswith("30초 '치즈밥 만들기' 장면")
    assert sk.far_scene_hint("치즈밥은 어떻게 만들어?", CHAPTERS, now_ms=35_000) is None  # 지금 장면이면 안내 없음


def test_split_sentences_and_stored_answers():
    done, rest = ans.split_sentences("첫 문장입니다. 둘째? 셋째 조각")
    assert done == ["첫 문장입니다.", "둘째?"] and rest.strip() == "셋째 조각"
    ctx = {"장면(앞 장면, 지금 장면)": [{"시작": "00:00", "제목": "숲길 산책", "장면 설명": "흰 생물이 걷습니다. 하늘이 맑습니다"}],
           "등장인물": [{"이름": "치이카와", "겉모습": "흰 몸에 작은 귀."}]}
    assert ans.scene_now(ctx) == ["숲길 산책.", "흰 생물이 걷습니다.", "하늘이 맑습니다"]
    assert ans.character_answer("치이카와는 어떻게 생겼어?", ctx) == ["치이카와의 겉모습은 이래요. 흰 몸에 작은 귀."]
    assert ans.character_answer("치이카와는 뭐 해?", ctx) is None
    assert ans.mmss(200_000) == "03:20"
