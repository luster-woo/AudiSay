"""업로드 영상 파이프라인(상황 먼저, app/pipeline/situation.py)의 순수 부분: 호칭 검사, 화면 글자 정리, 다친 곳 주인,
목소리 무리 표시, 대본 문장 나누기, 호칭을 인물로 저장(merge)."""
from app.pipeline import situation as st
from app.pipeline.merge import assemble


def test_upload_labels_have_no_names():
    """업로드 해설은 이름 대신 성별+겉모습 호칭. 대사에서 부른 이름·시리즈 사전 이름이 호칭에 들어가거나 성별 낱말이 없으면
    겉모습+성별로 다시 만든다."""
    look = {"cast": {"P1": {"gender": "남", "look": "검은 정장, 흰 셔츠"}, "P2": {"gender": "여", "look": "갈색 코트, 단발"},
                     "C1": {"gender": "모름", "look": "크림색 둥근 몸, 주황 갈기"}}}
    people = [{"id": "P1", "call": "민수 씨"}, {"id": "P2", "call": "갈색 코트 여성"}, {"id": "C1", "call": "치이카와"}]
    fixes = st.check_labels(people, look, [{"stem": "민수"}], "[전편공개]먼작귀 1화_치이카와의 하루")
    assert [p["call"] for p in people] == ["검은 정장 남성", "갈색 코트 여성", "크림색 둥근 몸 캐릭터"]
    assert len(fixes) == 2


def test_persistent_logo_kept_once_and_dialogue_subtitles_marked():
    """조각마다 꼴을 바꿔 다시 적은 로고·방송 시간은 한 번만(읽지 않음), 대사를 받아 적은 자막은 대사와 같음."""
    look = {"screen_text": [
        {"ms": 0, "kind": "제목", "text": "드라마 제목 [토일 밤 9:10]"},
        {"ms": 7_000, "kind": "자막", "text": "뭐 합니까?"},
        {"ms": 120_000, "kind": "제목", "text": "(토일) 밤 9:10"},
        {"ms": 225_000, "kind": "제목", "text": "드라마 제목 (토일 밤 9:10)"},
        {"ms": 300_000, "kind": "자막", "text": "네"},
        {"ms": 539_000, "kind": "제목", "text": "드라마 제목 [토일] 밤 9:10 tvN"},
        {"ms": 540_000, "kind": "간판", "text": "한의원"}]}
    notes = st.clean_screen_texts(look, [{"text": "뭐합니까?"}, {"text": "네."}], 579_000)
    texts = [(t["text"], bool(t.get("low")), bool(t.get("same"))) for t in look["screen_text"]]
    assert texts == [("드라마 제목 [토일 밤 9:10]", True, False), ("뭐 합니까?", False, True), ("네", False, True),
                     ("한의원", False, False)]
    assert len(notes) == 1


def test_injury_owner_follows_majority_and_text():
    """얼굴 없이 발만 잡힌 장면을 다음 장면 사람의 발목으로 적은 것을, 영상 전체에서 많이 적힌 주인으로 맞춘다."""
    look = {"seen": [{"ms": 45_000, "what": "P5가 P1의 발목을 만진다", "to": ["P1"]},
                     {"ms": 200_000, "what": "P1이 P2의 발목에 붕대를 감는다", "to": ["P2"]},
                     {"ms": 220_000, "what": "P4가 P2의 발목에 붕대를 감는다", "to": ["P2"]},
                     {"ms": 230_000, "what": "P4가 P2의 오른쪽 발목을 잡는다", "to": ["P2"]}]}
    fixes = st.fix_injury_owners(look)
    assert look["seen"][0]["what"] == "P5가 P2의 발목을 만진다" and look["seen"][0]["to"] == ["P2"] and len(fixes) == 1
    calls = {"P1": "검은 정장 남성", "P2": "갈색 코트 여성"}
    assert st.fix_injury_text("의사가 검은 정장 남성의 발목을 진찰한다", calls, look["injury_owner"]) == "의사가 갈색 코트 여성의 발목을 진찰한다"


def test_voice_groups_use_letters_not_person_numbers():
    """목소리 무리 "화자5"를 사람 번호 P5로 착각하지 않게 알파벳으로."""
    assert [st.voice_label(x) for x in ("화자1", "화자5", "화자26", "화자27", "P3", None)] == \
        ["목소리 A", "목소리 E", "목소리 Z", "목소리 AA", "P3", None]


def test_script_sentences_split_and_subjectless_tail_dropped():
    calls = {"P1": "검은 정장 남성", "P2": "갈색 코트 여성"}
    assert st.split_sentences("갈색 코트 여성의 얼굴이 가까이 잡힌다. 표정은 진지하다.", calls) == ["갈색 코트 여성의 얼굴이 가까이 잡힌다."]
    assert st.split_sentences("갈색 코트 여성이 앉는다. 검은 정장 남성이 일어난다.", calls) == \
        ["갈색 코트 여성이 앉는다.", "검은 정장 남성이 일어난다."]
    assert st.clean_ids("의사(P5)가 검은 정장 남성에게 말한다 (얼굴 번호표 P2)", {"P5": "의사"}) == "의사가 검은 정장 남성에게 말한다"


def test_labels_are_saved_as_characters():
    """업로드 영상 파이프라인은 호칭을 인물로 남긴다(이름 근거 확인 대상이 아님). 말한 사람·인물별 목소리에 쓴다."""
    full = {"durationMs": 30_000, "category": "ETC", "summary30s": "요약", "model": "local-video", "title": "올린 영상",
            "labelNames": True, "voiceNames": ["갈색 코트 여성"],
            "dialogues": [{"startMs": 1000, "endMs": 2000, "speaker": "갈색 코트 여성", "text": "안녕하세요"}],
            "scenes": [{"startMs": 0, "endMs": 30_000, "title": "진료실",
                        "people": [{"name": "갈색 코트 여성", "basis": "겉모습 호칭", "appearance": "여성, 갈색 코트"},
                                   {"name": "검은 정장 남성", "basis": "겉모습 호칭", "appearance": "남성, 검은 정장"}],
                        "screenTexts": []}],
            "lines": [], "chapters": []}
    plan = assemble(full, [{"chunkIndex": 0, "lines": [], "screenTexts": []}])
    assert [c["name"] for c in plan.characters] == ["갈색 코트 여성", "검은 정장 남성"]
    assert plan.dropped_names == []
