from app.pipeline.describe import build_chunk, join_near, place, spread
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
