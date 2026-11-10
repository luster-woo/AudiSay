from app.pipeline.describe import build_chunk, join_near, place, spread
from app.pipeline.prepare import make_chunks, normalize, pick_model
from app.pipeline.merge import assemble
from tests.fixtures import RAW


def full(duration_sec=190):
    return normalize(RAW, 15, "gemini-3.5-flash", duration_sec * 1000)


def test_pick_model():
    assert pick_model(720) == "gemini-3.5-flash"
    assert pick_model(60) == "gemini-3.8-flash"
    assert pick_model(None) == "gemini-3.8-flash"


def test_normalize_converts_times_and_codes():
    f = full()
    assert f["category"] == "ENTERTAINMENT"
    assert f["dialogues"][0] == {"startMs": 5000, "endMs": 9000, "speaker": "김철수", "text": "오늘은 라면을 끓여 볼게요."}
    assert f["scenes"][0]["screenTexts"][0]["importance"] == "HIGH"
    assert f["scenes"][0]["screenTexts"][0]["textType"] == "NAME_TAG"
    assert [x["atMs"] for x in f["lines"]] == sorted(x["atMs"] for x in f["lines"])


def test_chunks_cut_at_scene_boundary_and_cover_video():
    chunks = make_chunks(full(), 60)
    assert chunks[0]["startMs"] == 0 and chunks[-1]["endMs"] == 190_000
    for a, b in zip(chunks, chunks[1:]):
        assert a["endMs"] == b["startMs"]
    assert 70_000 in [c["startMs"] for c in chunks]  # 60초 근처의 장면 경계(01:10)에서 자름
    assert chunks[0]["contextSummary"] is None
    assert chunks[1]["contextSummary"] == "앞치마를 두른 남성이 부엌에 선다"


def test_chunk_never_cuts_inside_dialogue():
    chunks = make_chunks(full(), 122)  # 목표 122초는 02:00~02:06 대사 중간
    for c in chunks[1:]:
        assert not any(d["startMs"] < c["startMs"] < d["endMs"] for d in full()["dialogues"])


def test_short_video_is_one_chunk():
    f = full()
    f["durationMs"] = 50_000
    assert len(make_chunks(f, 120)) == 1


def test_place_moves_out_of_dialogue_and_sets_gap_end():
    d = full()["dialogues"]
    assert place(0, d, 190_000) == (0, 5000)
    assert place(7000, d, 190_000) == (9000, 20_000)  # 대사 중간 → 끝난 직후
    assert place(175_000, d, 190_000) == (180_000, 190_000)  # 마지막 대사 뒤 → 영상 끝까지
    assert place(4800, d, 190_000) == (4800, None)  # 0.2초 틈 → 빈 구간 없음


def test_build_chunk_nested_fields_and_checks():
    f = full()
    chunks = make_chunks(f, 60)
    built = [build_chunk(f, c["chunkIndex"], c["startMs"], c["endMs"]) for c in chunks]
    lines = [x for b in built for x in b["lines"]]
    assert len(lines) == len(f["lines"])  # 조각 사이에 빠지거나 겹친 문장 없음
    assert all(x["importance"] == 4 - x["detailLevel"] for x in lines)
    by_text = {x["text"]: x for x in lines}
    assert by_text["김철수가 냄비에 물을 붓는다."]["startMs"] == 9000
    assert "REFERS_BACK" in by_text["그는 젓가락으로 면을 젓는다."]["flags"]
    assert "REPEATS_DIALOGUE" in by_text["이제 맛을 볼까요?"]["flags"]
    assert "TOO_LONG" in [fl for x in lines for fl in x["flags"]]

    first = built[0]
    texts = [t["fullText"] for t in first["screenTexts"]]
    assert "김철수" not in texts  # 해설 문장에 이미 들어간 화면 글자는 뺀다
    assert "라면 끓이기 대결" in texts
    assert first["characters"][0]["nameSource"] == "SCREEN_TEXT"
    assert sum(len(b["dialogues"]) for b in built) == len(f["dialogues"])
    assert sum(len(b["screenTexts"]) for b in built) == 2  # 3개 중 '김철수'만 빠짐


def _ln(level, start, text, gap_end=None):
    return {"detailLevel": level, "startMs": start, "gapEndMs": gap_end, "importance": 4 - level, "text": text, "flags": []}


def test_near_lines_join_into_one_two_sentence_line():
    """1초 간격 같은 상세도 문장은 두 문장짜리 해설 하나로(2026-11-10 박진영 직캠 0·1초). 상세도가 다르면 그대로."""
    lines = [_ln(1, 0, "'하지하지마'라는 글자가 뜬다.", 5000), _ln(1, 1000, "박진영이 팔짱을 낀 채 서 있다.", 5000),
             _ln(2, 2000, "댄서들이 박진영을 에워싼다.", 5000), _ln(1, 2200, "세 번째 문장이다.", 5000)]
    out = join_near(lines)
    assert [(x["detailLevel"], x["startMs"], x["text"]) for x in out] == [
        (1, 0, "'하지하지마'라는 글자가 뜬다. 박진영이 팔짱을 낀 채 서 있다."),
        (2, 2000, "댄서들이 박진영을 에워싼다."),
        (1, 2200, "세 번째 문장이다.")]  # 두 문장까지만 묶는다


def test_spread_moves_lines_past_previous_reading():
    """앞 문장을 읽는 중에 시작하는 문장은 뒤로. 2:00에 두 문장이 몰린 경우(영상 끝 123초)."""
    song = [{"startMs": 5000, "endMs": 12_000, "text": "하지 마"}, {"startMs": 118_000, "endMs": 120_000, "text": "널 안아"}]
    lines = [_ln(1, 0, "박진영이 팔짱을 낀 채 서 있다.", 5000), _ln(2, 1000, "댄서들이 박진영을 에워싼다.", 5000),
             _ln(3, 3000, "출연진 모두 흰색 옷차림이다.", 5000),
             _ln(1, 120_000, "댄서들이 박진영 주변으로 모여든다.", 123_000), _ln(2, 120_000, "박진영이 고개를 젖힌 채 멈춘다.", 123_000)]
    spread(lines, song, 123_000)
    starts = [x["startMs"] for x in lines]
    assert starts[0] == 0 and starts[1] == 0 + 18 * 180 + 500  # 첫 문장(18자)을 다 읽고 숨 0.5초 뒤
    assert lines[1]["gapEndMs"] == 5000
    assert starts[2] == starts[1] + 1000 and lines[2]["gapEndMs"] is None  # 2번은 빈 구간에 안 들어가 멈추고 읽음 → 1초 뒤(틈 0.26초)
    assert starts[3:] == [120_000, 121_000]  # 같은 시각 두 문장을 띄운다
    assert all(a < b for a, b in zip(starts, starts[1:]))


def _foreign_raw():
    return {**RAW, "dialogue": [
        {"start": "00:05", "end": "00:09", "speaker": "김철수", "text": "오늘은 라면을 끓여 볼게요.", "language": "ko", "translation": None},
        {"start": "00:20", "end": "00:24", "speaker": "총독", "text": "本日は五月十五日。", "language": "ja", "translation": "금일 5월 15일."},
        {"start": "00:30", "end": "00:50", "speaker": "태웅(진영)", "text": "His Excellency would like to make a toast. ...",
         "language": "en", "translation": "총독 각하의 건배사입니다. 조선 최초의 기송관이 성공적으로 개통되었습니다. "
                                          "이는 조선 근대화의 새로운 이정표이며 만선 번영의 첫걸음이 될 것입니다."},
        {"start": "00:50", "end": "00:52", "speaker": "태웅 (통역관)", "text": "Thank you.", "language": "en", "translation": "이상입니다."},
        {"start": "00:55", "end": "00:56", "speaker": "null", "text": "OK!", "language": "en", "translation": None},
    ]}


def test_foreign_dialogue_is_read_in_korean_at_its_time():
    f = normalize(_foreign_raw(), 15, "gemini-3.5-flash", 190_000)
    ja = f["dialogues"][1]
    assert (ja["text"], ja["original"], ja["dub"]) == ("금일 5월 15일.", "本日は五月十五日。", True)
    assert "dub" not in f["dialogues"][0] and "dub" not in f["dialogues"][4]  # 한국어, 번역 없는 한두 마디

    lines = [x for x in build_chunk(f, 0, 0, 190_000)["lines"] if "DIALOGUE_DUB" in x["flags"]]
    assert [(x["startMs"], x["text"]) for x in lines] == [
        (20_000, "총독: 금일 5월 15일."),
        (30_000, "태웅: 총독 각하의 건배사입니다. 조선 최초의 기송관이 성공적으로 개통되었습니다."),  # 60자 안에서 문장끼리 묶음
        (40_123, "이는 조선 근대화의 새로운 이정표이며 만선 번영의 첫걸음이 될 것입니다."),
        (50_000, "이상입니다."),  # 같은 사람이 이어 말하면 이름을 다시 붙이지 않는다
    ]
    assert all(x["detailLevel"] == 1 and x["gapEndMs"] is None for x in lines)
    # 붙어 있어도 해설 문장과 한 문장으로 묶지 않는다
    near = join_near([_ln(1, 19_500, "총독이 단상에 선다."), dict(lines[0])])
    assert len(near) == 2


def test_dub_lines_are_read_but_kept_out_of_chapters_and_scenes():
    """외국어 대사 번역 문장은 description_lines에 남겨 플레이어가 읽게 하고, 합쳐 저장하는 목차 요약·키워드·장면 설명에는 넣지 않는다.
    (BE 챗봇이 목차·장면 설명을 '화면 해설'로 읽는다. 대사는 transcript_segments에 따로 있다)"""
    f = normalize(_foreign_raw(), 15, "gemini-3.5-flash", 190_000)
    plan = assemble(f, [{**build_chunk(f, 0, 0, 190_000), "chunkIndex": 0}])
    dubs = [x["text"] for x in plan.lines if "DIALOGUE_DUB" in x["flags"]]
    assert len(dubs) == 4  # 플레이어가 읽어 줄 문장은 그대로
    assert any(d["text"] == "금일 5월 15일." for d in plan.dialogues)  # 대사에는 한국어 번역
    stored = [c["summary"] or "" for c in plan.chapters] + [s["sceneDescription"] for s in plan.scenes]
    assert stored and not any(d in t or d.split(": ", 1)[-1] in t for d in dubs for t in stored)
    assert not any("건배사" in k or "기송관" in k for c in plan.chapters for k in c["keywords"])


def test_dub_speaker_drops_actor_name_and_null():
    from app.pipeline.describe import dub_lines
    d = lambda s, sp: {"startMs": s, "endMs": s + 1000, "speaker": sp, "text": "건배!", "dub": True}
    assert [x["text"] for x in dub_lines([d(0, "김태웅(진영)"), d(2000, "null")])] == ["김태웅: 건배!", "건배!"]


def test_spread_does_not_push_a_line_into_the_middle_of_dialogue():
    """밀린 시각이 대사 한가운데면 대사 끝으로 다시 옮긴다(2026-11-10 점검: 2~8초 대사, 1.8초 문장이 2.5초로 밀려
    대사가 시작되고 0.5초 만에 영상이 멈췄다)."""
    talk = [{"startMs": 2000, "endMs": 8000, "text": "오늘은 그래프를 읽어 볼게요"}]
    lines = [_ln(1, 0, "칠판 그래프가 보인다.", 2000), _ln(1, 1800, "선생님이 들어온다.", 2000)]  # 12자 → 2.66초까지 읽음
    spread(lines, talk, 60_000)
    assert lines[1]["startMs"] == 8000
    assert lines[1]["gapEndMs"] == 60_000
