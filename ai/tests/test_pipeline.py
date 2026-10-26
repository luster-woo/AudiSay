from app.pipeline.describe import build_chunk, place
from app.pipeline.prepare import make_chunks, normalize, pick_model
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
