"""업로드 영상(LOCAL) 분석: 데모에서 검증한 규칙이 그대로 옮겨졌는지, 그리고 가짜 H200으로 분석 → full.json → merge까지.

ffmpeg·PySceneDetect·H200·GMS·DB는 부르지 않는다(장면 나누기와 사진 뽑기, 줄거리용 사진은 가짜로 바꿔 끼움).
"""
import asyncio
from pathlib import Path

from app import inference
from app.pipeline import local, prompts
from app.pipeline import translate_fix as tf
from app.pipeline.describe import place
from app.pipeline.merge import assemble
from app.pipeline.prepare import make_chunks, normalize


def test_finish_sentence_fixes_noun_endings():
    assert local.finish_sentence("메뉴판이 표시됨") == "메뉴판이 표시됩니다."
    assert local.finish_sentence("냄비가 있음") == "냄비가 있습니다."
    assert local.finish_sentence("양파를 썹니다") == "양파를 썹니다."
    assert local.finish_sentence("정말요?") == "정말요?"
    assert local.finish_sentence("  ") == ""


def test_cap_lines_limits_by_scene_length_and_dedups():
    lines = [{"level": 1, "text": "가"}, {"level": 1, "text": "나"}, {"level": 3, "text": "다"},
             {"level": 2, "text": "라"}, {"level": 2, "text": "라 "}]
    kept = local.cap_lines(lines, 8000)  # 8초 → 상세도 1·2는 1문장, 상세도 3은 2문장
    assert [x["text"] for x in kept] == ["가", "다"]  # 상세도 3에 몫이 남으면 level 3을 넣는다, 같은 문장은 하나
    assert len(local.cap_lines(lines, 1000)) == 1


def test_cap_lines_gives_each_detail_level_its_own_share():
    """짧은 장면이 이어져도 상세도 2와 3이 달라야 한다(2026-11-12 크레페: level 3이 0개라 상세도 2·3이 같았다)."""
    lines = [{"level": 1, "text": f"일{i}"} for i in range(3)] + [{"level": 2, "text": f"이{i}"} for i in range(4)] \
        + [{"level": 3, "text": f"삼{i}"} for i in range(3)]
    for ms, want in [(6000, (1, 0, 1)), (12_000, (1, 1, 1)), (20_000, (2, 1, 2))]:
        kept = local.cap_lines(lines, ms)
        assert tuple(sum(x["level"] == lv for x in kept) for lv in (1, 2, 3)) == want, ms


def test_group_sentences_by_end_mark_or_12s():
    segs = [{"startMs": 0, "endMs": 2000, "text": "Add five garlic"}, {"startMs": 2000, "endMs": 4000, "text": "cloves."},
            {"startMs": 4000, "endMs": 10_000, "text": "Then stir"}, {"startMs": 10_000, "endMs": 17_000, "text": "slowly and"},
            {"startMs": 17_000, "endMs": 18_000, "text": "wait"}]
    g = local.group_sentences(segs)
    assert [x["text"] for x in g] == ["Add five garlic cloves.", "Then stir slowly and", "wait"]
    assert (g[1]["startMs"], g[1]["endMs"]) == (4000, 17_000)


def test_split_scenes_merges_short_and_splits_long():
    cuts = [(0, 10_000), (10_000, 12_000), (12_000, 50_000)]
    # 38초 장면은 15초씩 자르지 않고 고르게 셋으로(끝에 8초짜리가 남지 않게)
    assert local.split_scenes(cuts, 50_000) == [{"startMs": 0, "endMs": 12_000}, {"startMs": 12_000, "endMs": 24_666},
                                                {"startMs": 24_666, "endMs": 37_333}, {"startMs": 37_333, "endMs": 50_000}]


def test_silent_scenes_split_finer_and_frames_dense():
    assert local.split_long([{"startMs": 74_000, "endMs": 93_000}], 12.0) == [{"startMs": 74_000, "endMs": 83_500},
                                                                              {"startMs": 83_500, "endMs": 93_000}]
    # 15초 장면이 12초 + 3초로 나뉘어 3초 장면마다 같은 제목을 썼다(2026-11-12 크레페)
    assert local.split_long([{"startMs": 78_000, "endMs": 93_000}], 12.0) == [{"startMs": 78_000, "endMs": 85_500},
                                                                              {"startMs": 85_500, "endMs": 93_000}]
    assert local.frames_for_silent(12_000) == 4 and local.frames_for_silent(21_000) == 7 and local.frames_for_silent(60_000) == 8


def test_frames_for_and_overlaps():
    assert local.frames_for(3000) == 4 and local.frames_for(15_000) == 5 and local.frames_for(120_000) == 8
    assert local.overlaps({"startMs": 5000, "endMs": 15_000}, {"startMs": 10_000, "endMs": 20_000})
    assert not local.overlaps({"startMs": 0, "endMs": 10_000}, {"startMs": 10_000, "endMs": 20_000})


def test_translate_problem_detection():
    assert tf.problem("five garlic cloves", "마늘 3쪽") is not None  # 숫자 다름
    assert tf.problem("five garlic cloves.", "마늘 다섯 쪽이에요.") is None
    assert tf.problem("add turmeric", "투르메이신을 넣어요") is not None  # 용어 누락
    assert tf.problem("Hello there", "Hello there") == "번역 안 됨"
    assert tf.problem("one cup", "물 한 컵을 넣습니다.") == "말투(해요체 아님)"


def test_place_caps_shift_for_nonstop_narration():
    # 대사가 쉬지 않고 이어지면 6초 넘게 밀지 않고 첫 대사 끝에 두고 gapEndMs는 null
    talk = [{"startMs": i * 3000, "endMs": i * 3000 + 3000, "text": "말"} for i in range(10)]
    assert place(1000, talk, 30_000) == (3000, None)
    # 틈이 있으면 예전처럼 대사 끝 + 다음 대사 시작
    assert place(1000, [{"startMs": 0, "endMs": 2000, "text": "a"}, {"startMs": 5000, "endMs": 6000, "text": "b"}], 10_000) == (2000, 5000)



def test_place_keeps_time_inside_long_song_segment():
    """노래 한 절이 대사 하나(0:03~1:15)로 잡히면 끝(1:15)으로 몰지 않고 원래 시각에 둔다(데모 2026-11-02)."""
    song = [{"startMs": 3_000, "endMs": 75_000, "text": "가사"}, {"startMs": 87_000, "endMs": 182_000, "text": "가사"}]
    assert [place(a, song, 207_000) for a in (8_000, 38_000, 99_000, 158_000)] == [
        (8_000, None), (38_000, None), (99_000, None), (158_000, None)]
    assert place(72_000, song, 207_000) == (75_000, 87_000)  # 끝이 6초 안이면 예전처럼 끝난 직후 빈 구간으로

def test_genre_guide_uses_character_book():
    extra, series = prompts.genre_guide("먼작귀 113화")
    assert series == "chiikawa" and "시리즈 등장인물 사전" in extra and "치이카와" in extra
    extra, series = prompts.genre_guide("망고 커리 레시피")
    assert series is None and "요리 영상 해설 지침" in extra
    assert prompts.genre_guide(None) == ("", None)


def test_local_analysis_end_to_end_with_mock_h200(tmp_path, monkeypatch):
    """가짜 H200(외국어 받아쓰기 포함) → raw → normalize(full.json) → 조각 → merge.assemble."""

    class FakeH200(inference.MockInference):
        async def transcribe(self, wav):
            return {"segments": [{"startMs": 1000, "endMs": 3000, "text": "Add two onions."},
                                 {"startMs": 21_000, "endMs": 24_000, "text": "Stir well."}], "language": "en", "model": "whisper"}

        async def translate(self, texts, source=None, title=None):
            return {"texts": ["양파 두 개를 넣어요.", "잘 저어요."], "model": "qwen"}

        async def ocr(self, images):
            return {"texts": [["STEP 1"] for _ in images]}

        async def sounds(self, wav):
            return {"events": [{"startMs": 22_000, "endMs": 26_000, "label": "Sizzle", "ko": "지글거리는 소리"}], "model": "sound"}

        async def story(self, payload):
            assert payload["frames"] == [(1500, tmp_path / "a.jpg")] and "겉모습 호칭" in payload["guide"]
            assert payload["transcript"] == "1초 양파 두 개를 넣어요.\n21초 잘 저어요." and payload["sounds"] == "22~26초 지글거리는 소리"
            return {"model": "Qwen3-VL-32B", "events": [{"atMs": 2000, "text": "양파를 냄비에 넣는다"}],
                    "names": [{"name": "백종원", "what": "앞치마 입은 남성"}, {"name": "양파", "what": ""}]}

        async def describe(self, payload):
            assert "외국어" in payload["guide"] and "요리 영상 해설 지침" in payload["guide"]
            assert payload["scenes"][0]["transcript"] == "양파 두 개를 넣어요."
            # 줄거리·인물표: 제목·화면 글자·대사에 없는 이름(백종원)은 겉모습 호칭으로 바뀌어 모든 장면에 넘어간다
            assert payload["storyline"] == "2초 양파를 냄비에 넣는다" and payload["names"] == "앞치마 입은 남성, 양파"
            assert "정해 둔 인물·물건 이름" in payload["guide"]
            assert [s["events"] for s in payload["scenes"]] == ["양파를 냄비에 넣는다", ""]
            assert [s["sounds"] for s in payload["scenes"]] == ["", "22~26초 지글거리는 소리"]
            return {"model": "Qwen3-VL-8B", "scenes": [
                {"title": "양파 넣기", "people": [{"name": None, "basis": None, "appearance": "앞치마 입은 손"}],
                 "lines": [{"atMs": 500, "level": 1, "text": "양파가 냄비에 들어가 있음"}, {"atMs": 2000, "level": 3, "text": "냄비가 빨갛습니다"},
                           {"atMs": 9000, "level": 2, "text": "남자는 흰 앞치마를 입고 있습니다"},
                           {"atMs": 12_000, "level": 2, "text": '{"title": "양파 넣기", "people": ['}]},
                {"title": "볶기", "people": [], "lines": [{"atMs": 25_000, "level": 1, "text": "주걱으로 볶습니다"},
                                                       {"atMs": 30_000, "level": 2, "text": "양파가 냄비에 들어가 있습니다"}]}]}

        async def summarize(self, payload):
            assert payload["lines"][0] == "양파를 냄비에 넣는다"  # 줄거리 사건이 요약 입력 앞에
            return await super().summarize(payload)

    scenes = [{"startMs": 0, "endMs": 20_000}, {"startMs": 20_000, "endMs": 40_000}]
    monkeypatch.setattr(local, "detect_scenes", lambda path, ms: scenes)
    monkeypatch.setattr(local, "timeline_frames", lambda playback, work, ms: [(1500, tmp_path / "a.jpg")])
    monkeypatch.setattr(local, "frames", lambda playback, work, sc, per_scene=4: [[tmp_path / "a.jpg"] for _ in sc])
    files = {"playback": tmp_path / "playback.mp4", "wav": tmp_path / "a.wav"}
    seen = []

    async def progress(pct):
        seen.append(pct)

    raw, model, errors = asyncio.run(local.analyze("opensource", FakeH200(), None, False, "양파 볶음 레시피", files, tmp_path,
                                                   40_000, progress, 7))
    assert model == "local:Qwen3-VL-8B" and errors == []
    assert seen == sorted(seen) and max(seen) < 20  # PREPARE 진행률 안
    assert raw["dialogue_language"] == "en"
    assert raw["dialogue"][0]["text"] == "양파 두 개를 넣어요." and raw["dialogue"][0]["original"] == "Add two onions."
    assert raw["lines"][0]["text"] == "양파가 냄비에 들어가 있습니다."  # 개조식 끝 고침
    # 끊긴 JSON 조각, 앞 장면에서 한 말, 옷차림만 있는 문장은 빠지고 겹친 시각은 2초 띄운다(0.5초·2초 → 2.5초)
    assert [(x["at"], x["text"]) for x in raw["lines"]] == [("00:00", "양파가 냄비에 들어가 있습니다."),
                                                           ("00:25", "주걱으로 볶습니다.")]  # 0.5초·2초 두 문장은 4.5초 안이라 하나만(thin_levels)
    assert raw["scenes"][0]["screen_text"] == [{"text": "STEP 1", "text_type": "OTHER", "importance": "중", "same_as_dialogue": False}]

    full = normalize(raw, 3, model, 40_000)
    assert full["dialogues"][0]["original"] == "Add two onions."
    chunks = make_chunks(full, 120)
    assert len(chunks) == 1
    # describe가 하는 일을 흉내: 문장 배치 결과를 조각으로
    chunk = {"chunkIndex": 0, "screenTexts": [],
             "lines": [{"detailLevel": x["detailLevel"], "startMs": x["atMs"], "gapEndMs": None, "text": x["text"], "flags": []}
                       for x in full["lines"]]}
    plan = assemble(full, [chunk], model=model)
    assert plan.model == "local:Qwen3-VL-8B"
    assert plan.dialogue_language == "en" and plan.dialogues[0]["original"] == "Add two onions."  # DB 저장은 V5 뒤(지금은 full.json에만)
    assert [s["title"] for s in plan.scenes] == ["양파 넣기", "볶기"]
    assert "이름 모르는 인물(앞치마 입은 손)" in plan.scenes[0]["sceneDescription"]


def test_video_without_speech_is_described_by_action(tmp_path, monkeypatch):
    """받아쓴 말이 없으면 장면을 12초로 더 나누고 사진을 3초에 1장으로 뽑아 동작 중심 지침을 준다. 자막이 많으면 자막 지침도."""
    captions = iter(["하지 마!", "이거 스노우?", "머리가 너무 작다"])
    got = {}

    class Silent(inference.MockInference):
        async def ocr(self, images):
            return {"texts": [[next(captions)] for _ in images]}

        async def describe(self, payload):
            got["guide"] = payload["guide"]
            got["scenes"] = [(s["startMs"], s["endMs"]) for s in payload["scenes"]]
            return await super().describe(payload)

    def frames(playback, work, sc, per_scene=4):
        got["per_scene"] = per_scene
        return [[tmp_path / f"{i}.jpg"] for i, _ in enumerate(sc)]

    monkeypatch.setattr(local, "detect_scenes", lambda path, ms: [{"startMs": 0, "endMs": 30_000}])
    monkeypatch.setattr(local, "frames", frames)
    monkeypatch.setattr(local, "timeline_frames", lambda playback, work, ms: [])

    async def progress(pct):
        pass

    asyncio.run(local.analyze("opensource", Silent(), None, False, "라마와 펭귄", {"playback": tmp_path / "p.mp4", "wav": tmp_path / "a.wav"},
                              tmp_path, 30_000, progress, 7))
    assert got["scenes"] == [(0, 10_000), (10_000, 20_000), (20_000, 30_000)] and got["per_scene"] is local.frames_for_silent
    assert "이 영상에는 대사가 없습니다" in got["guide"] and "화면 자막이 대사 역할" in got["guide"]


def test_clean_ocr_drops_logos_and_keeps_captions():
    """늘 떠 있는 로고는 OCR 오타가 달라도 빼고, 장면마다 다른 자막은 남긴다(2026-11-02 데모)."""
    scenes = [["코보티비", "보령·한국도로공사컵", "됐따!", "5"], ["코보E비", "보령·안국도로공사컵", "이거~스노우?"],
              ["코보O티비", "보령·한국도로공사컵", "하지마!"], ["코보티비", "머리가 너무 작다"]]
    assert local.clean_ocr(scenes) == [["됐따!"], ["이거~스노우?"], ["하지마!"], ["머리가 너무 작다"]]
    assert local.clean_ocr([["로고", "자막"], ["로고"]]) == [["로고", "자막"], ["로고"]]  # 장면이 적으면 로고로 보지 않는다


def test_json_fragment_and_crowded_lines_are_fixed():
    """끊긴 JSON 조각은 문장으로 쓰지 않고, 같은 시각에 겹친 문장은 2초씩 띄운다."""
    assert local.looks_like_json('{"title": "라마와 펭귄이 눈밭에서 쉬고 있습니다", "people": [{"name": "라마",.')
    assert not local.looks_like_json("라마가 \"안녕\"이라고 쓴 팻말을 듭니다.")
    scene = {"startMs": 74000, "endMs": 93000}
    out = local.spread_lines([{"atMs": 92000, "level": 2, "text": "a"}, {"atMs": 92000, "level": 2, "text": "b"},
                              {"atMs": 74300, "level": 1, "text": "c"}], scene)
    assert [x["text"] for x in out] == ["c", "a"]  # b는 장면 끝을 넘어 뺀다
    assert out[0]["atMs"] == 74300


def test_repeated_lines_across_scenes_are_dropped():
    scenes = [{"lines": [{"text": "안경 쓴 남자가 테이블 앞에 앉아 있습니다."}, {"text": "남자는 체크무늬 셔츠를 입고 있습니다."}]},
              {"lines": [{"text": "안경 쓴 남자가 나무 테이블에 앉아 있습니다."}, {"text": "남자 뒤 벽에 로고가 붙어 있습니다."}]},
              {"lines": [{"text": "남자는 체크무늬 셔츠를 입고 있습니다."}]}]
    local.drop_repeats(scenes)
    assert [len(s["lines"]) for s in scenes] == [2, 1, 0]  # 다 겹친 장면은 해설 없이(같은 문장을 남기지 않는다)
    assert scenes[1]["lines"][0]["text"].startswith("남자 뒤 벽")


def test_similar_lines_nearby_are_dropped_but_far_ones_kept():
    """30초 안에서는 덜 닮아도 같은 말로 본다(크레페 '뒤집습니다' 네 번). 멀리 떨어진 비슷한 문장은 남긴다."""
    scenes = [{"lines": [{"atMs": 196_000, "text": "팬에서 익은 크레페를 뒤집습니다."}]},
              {"lines": [{"atMs": 217_000, "text": "팬 안의 크레페를 뒤집습니다."}]},
              {"lines": [{"atMs": 290_000, "text": "팬 안의 크레페를 뒤집습니다."}]}]
    local.drop_repeats(scenes)
    assert [len(s["lines"]) for s in scenes] == [1, 0, 1]  # 두 번째는 30초 안이라 빼고, 73초 뒤 같은 동작은 새 일로 남긴다
    far = [{"lines": [{"atMs": 0, "text": "팬에서 익은 크레페를 뒤집습니다."}]},
           {"lines": [{"atMs": 120_000, "text": "팬 안의 크레페를 뒤집습니다."}]}]
    local.drop_repeats(far)
    assert [len(s["lines"]) for s in far] == [1, 1]


def test_neighbor_scenes_with_same_title_merge_into_one_chapter():
    scenes = [{"startMs": 66_000, "endMs": 78_000}, {"startMs": 78_000, "endMs": 81_000},
              {"startMs": 81_000, "endMs": 88_000}, {"startMs": 88_000, "endMs": 103_000}]
    desc = [{"title": "가루 재료를 액체에 넣고 섞습니다", "people": [], "lines": [{"text": "a"}]},
            {"title": "반죽을 체에 거릅니다", "people": [], "lines": []},
            {"title": "반죽을 체에 거릅니다", "people": [], "lines": [{"text": "b"}]},
            {"title": "반죽을 체에 거릅니다.", "people": [], "lines": [{"text": "c"}]}]
    s2, d2, o2 = local.merge_similar_scenes(scenes, desc, [["체"], [], ["체", "125g"], []])
    assert [(s["startMs"], s["endMs"]) for s in s2] == [(66_000, 78_000), (78_000, 103_000)]
    assert d2[1]["title"] == "반죽을 체에 거릅니다" and [x["text"] for x in d2[1]["lines"]] == ["b", "c"]
    assert o2 == [["체"], ["체", "125g"]]


def test_idle_and_speech_act_lines_are_dropped():
    """옷차림만·'말한다'만 있는 문장, 말한 내용을 요약한 문장은 빼고 동작·표정이 함께 있으면 남긴다."""
    lines = [{"text": t} for t in ["주우재는 줄무늬 티셔츠를 입고 있습니다.", "검은 후드티 청년 남성이 말한다.",
                                   "휴대폰을 들여다보며 말합니다.", "남자가 자리에서 일어납니다."]]
    assert [x["text"] for x in local.drop_idle(lines)] == ["휴대폰을 들여다보며 말합니다.", "남자가 자리에서 일어납니다."]
    lines = [{"text": t} for t in ["AI가 볼링을 추천합니다.", "남성이 비용을 우려합니다.", "남성이 웃으며 대답합니다.",
                                   "여성이 계산대로 걸어갑니다."]]
    assert [x["text"] for x in local.drop_speech_acts(lines)] == ["남성이 웃으며 대답합니다.", "여성이 계산대로 걸어갑니다."]


def test_filter_before_line_limit():
    """대사를 옮긴 문장·옷차림만 있는 문장을 문장 수 한도보다 먼저 빼서 표정·몸짓 문장이 자리를 얻는다."""
    lines = [{"atMs": 1000, "level": 1, "text": "남성이 집에 가자고 말합니다."},
             {"atMs": 2000, "level": 2, "text": "남성이 검은 옷을 입고 있습니다."},
             {"atMs": 3000, "level": 2, "text": "아이가 귀를 막고 고개를 젓습니다."}]
    assert local.drop_early(lines, []) == lines[2:]
    assert local.cap_lines(local.drop_early(lines, []), 4000) == lines[2:]  # 한도 1: 먼저 거르지 않으면 level 1만 남았다가 뒤에서 빠진다


def test_screen_lines_picked_from_ocr(tmp_path):
    """대사 자막·로고·외국어를 뺀 화면 글자를 사진과 함께 32B에 묻고, 고른 글자로 정해진 틀의 문장을 만든다."""
    shots = [[tmp_path / "a.jpg", tmp_path / "b.jpg"], [tmp_path / "c.jpg", tmp_path / "d.jpg"]]
    for group in shots:
        for f in group:
            f.write_bytes(b"jpg")
    scenes = [{"startMs": 0, "endMs": 10_000}, {"startMs": 10_000, "endMs": 20_000}]
    texts = [["저녁먹죠", "PLAY"], ["거짓과 기억"], ["거짓과기억", "10월 30일 첫 방송", "나이어", "01"], ["엠비씨"]]
    kept = [["저녁먹죠", "PLAY", "거짓과 기억"], ["거짓과기억", "10월 30일 첫 방송", "나이어", "01"]]  # 엠비씨는 로고로 빠졌다
    segs = [{"startMs": 1000, "endMs": 3000, "text": "우리 저녁 먹죠"}]
    cands = local.screen_candidates(scenes, shots, texts, kept, segs)
    assert [(c["atMs"], c["text"], c["frame"].name) for c in cands] == [
        (7500, "거짓과 기억", "b.jpg"), (12_500, "10월 30일 첫 방송", "c.jpg"), (12_500, "나이어", "c.jpg")]

    class Inf:
        async def generate_json(self, prompt, schema, max_tokens=2000, images=None):
            assert len(images) == 1
            if "1. 거짓과 기억" in prompt:
                return {"result": {"items": [{"no": 1, "kind": "title", "text": "완전히 다른 글자"},
                                             {"no": 5, "kind": "title", "text": "없는 번호"}]}}
            return {"result": {"items": [{"no": 1, "kind": "notice", "text": "10월 30일 첫 방송"},
                                         {"no": 2, "kind": "title", "text": "라이어"}]}}

    notes = asyncio.run(local.pick_screen_lines(Inf(), "라이어", cands, 20_000))
    assert [(n["atMs"], n["text"]) for n in notes] == [(7500, "화면에 '거짓과 기억' 문구가 뜹니다."),
                                                       (12_500, "화면에 '10월 30일 첫 방송', '라이어' 문구가 뜹니다.")]
    assert asyncio.run(local.pick_screen_lines(Inf(), "라이어", cands, 5_000)) == []  # 5초에 글자 셋 = 자막이 많은 영상


def test_describe_split_keeps_scene_order(monkeypatch):
    """장면을 8개씩 나눠 동시에 보내도 장면 순서·수는 그대로고 못 받은 제목 번호는 전체 번호다."""
    calls = []

    class Inf:
        async def describe(self, payload):
            calls.append(len(payload["scenes"]))
            return {"model": "m", "scenes": [{"title": f"{i + 1}번째 장면", "people": [],
                                              "lines": [{"atMs": s["startMs"], "level": 1, "text": str(s["startMs"])}]}
                                             for i, s in enumerate(payload["scenes"])]}

    payload = {"title": "t", "scenes": [{"startMs": k * 1000, "endMs": (k + 1) * 1000} for k in range(20)]}
    out = asyncio.run(local.describe_scenes(Inf(), payload))
    assert sorted(calls) == [4, 8, 8] and out["model"] == "m"
    assert [sc["lines"][0]["text"] for sc in out["scenes"]] == [str(k * 1000) for k in range(20)]
    assert [sc["title"] for sc in out["scenes"]] == [f"{k + 1}번째 장면" for k in range(20)]
    calls.clear()
    monkeypatch.setattr(local, "DESCRIBE_SPLIT", 1)
    one = asyncio.run(local.describe_scenes(Inf(), payload))
    assert calls == [20] and len(one["scenes"]) == 20


def test_ground_names_keeps_only_names_with_evidence(monkeypatch):
    names = [{"name": "철수", "what": "빨간 모자 남성"}, {"name": "영희", "what": "안경 쓴 여성"}, {"name": "민수", "what": ""}]
    segs = [{"text": "영희야 이리 와"}]
    monkeypatch.setattr(local, "NAME_SOURCE", "all")
    out = local.ground_names(names, "철수의 하루", [["OPEN"]], segs)
    assert [n["name"] for n in out] == ["철수", "영희", "민수"] and out[2]["what"] == ""  # 제목·대사에 있으면 그대로, 호칭이 없으면 이름 유지
    monkeypatch.setattr(local, "NAME_SOURCE", "screen")  # 대사에서만 들린 이름은 화면의 누구인지 몰라 쓰지 않는다
    out = local.ground_names(names, "철수의 하루", [["OPEN"]], segs)
    assert out[1] == {"name": "안경 쓴 여성", "what": ""} and out[0]["name"] == "철수"


def test_engine_fallback_to_gemini_when_h200_fails(tmp_path):
    class DownH200(inference.MockInference):
        async def transcribe(self, wav):
            raise inference.InferenceError("INFER_UNREACHABLE", "끊김")

    async def progress(pct):
        pass

    # GMS도 꺼져 있으면 두 엔진 다 실패 → WorkerError
    try:
        asyncio.run(local.analyze("opensource", DownH200(), None, False, "t", {"playback": Path("x"), "wav": None}, tmp_path,
                                  10_000, progress, 1))
    except Exception as e:  # noqa: BLE001
        assert "opensource: INFER_UNREACHABLE" in str(e) and "gemini: GMS 꺼짐" in str(e)
    else:
        raise AssertionError("실패해야 함")


def test_frames_survive_failed_shots(tmp_path, monkeypatch):
    """영상 끝을 넘는 시각은 끝 0.2초 앞으로 당기고, 실패하면 1초 앞에서 한 번 더. 그래도 없으면 앞 장면의 마지막 사진을 쓴다."""
    asked = []

    def ff(*args):
        t = float(args[1])
        asked.append(t)
        if t >= 8.7:  # 8.7초부터는 뽑히지 않는 영상
            raise local.WorkerError("TRANSCODE_FAILED", "ffmpeg 실패")
        Path(args[-1]).write_bytes(b"jpg")

    monkeypatch.setattr(local, "_ff", ff)
    monkeypatch.setattr(local, "video_end_sec", lambda path: 10.0)
    scenes = [{"startMs": 0, "endMs": 8000}, {"startMs": 8000, "endMs": 10_000}, {"startMs": 10_000, "endMs": 12_000}]
    shots = local.frames(tmp_path / "p.mp4", tmp_path, scenes, per_scene=2)
    assert [len(g) for g in shots] == [2, 2, 1] and all(p.exists() for g in shots for p in g)
    assert shots[2] == [shots[1][-1]] and max(asked) == 9.8  # 셋째 장면(영상 끝 뒤)은 둘째 장면의 마지막 사진
    # 둘째 장면: 8.5초는 바로, 9.5초는 실패해 8.5초(1초 앞)에서 다시. 셋째 장면: 9.8초도 8.8초도 실패
    assert sorted(asked) == [2.0, 6.0, 8.5, 8.5, 8.8, 8.8, 9.5, 9.8, 9.8]

    monkeypatch.setattr(local, "_ff", lambda *a: (_ for _ in ()).throw(local.WorkerError("TRANSCODE_FAILED", "ffmpeg 실패")))
    try:
        local.frames(tmp_path / "p.mp4", tmp_path / "none", [{"startMs": 0, "endMs": 4000}])
    except local.WorkerError as e:
        assert e.code == "TRANSCODE_FAILED"
    else:
        raise AssertionError("실패해야 함")


def test_small_playback_goes_to_gemini_as_is(tmp_path, monkeypatch):
    """한도 안의 재생용 파일은 사본을 만들지 않는다(ffmpeg를 부르지 않음). 넘으면 gemini.mp4 사본으로."""
    small = tmp_path / "playback.mp4"
    small.write_bytes(b"x" * 1000)
    monkeypatch.setattr(local, "_ff", lambda *a: (_ for _ in ()).throw(AssertionError("ffmpeg를 부르면 안 됨")))
    assert local.gemini_copy(small, 60) == small

    made = []

    def ff(*args):
        made.append(args)
        Path(args[-1]).write_bytes(b"y" * 100)

    monkeypatch.setattr(local, "INLINE_MAX_BYTES", 500)
    monkeypatch.setattr(local, "_ff", ff)
    out = local.gemini_copy(small, 3600)
    assert out.name == "gemini.mp4" and len(made) == 1
    assert "-ac" in made[0] and "scale='min(640,iw)':-2,fps=2" in made[0]


def test_h200_down_goes_straight_to_gemini(tmp_path, monkeypatch):
    """GPU 서버(터널)가 끊겼으면 H200 엔진을 건너뛰고 바로 Gemini로(유튜브 영상처럼, 2026-11-06)."""
    called = []

    class DownH200(inference.MockInference):
        async def healthy(self):
            return False

        async def transcribe(self, wav):
            called.append("h200")
            raise inference.InferenceError("INFER_UNREACHABLE", "끊김")

    async def gemini(gms, title, playback, duration_sec, job_id):
        called.append("gemini")
        return {"lines": []}, "gemini:gemini-3.8-flash"

    async def progress(pct):
        pass

    monkeypatch.setattr(local, "analyze_gemini", gemini)
    raw, model, errors = asyncio.run(local.analyze("video", DownH200(), object(), True, "t", {"playback": Path("x"), "wav": None},
                                                   tmp_path, 10_000, progress, 1))
    assert called == ["gemini"] and errors == ["h200: 연결 안 됨"] and model == "gemini:gemini-3.8-flash (대체)"


def test_thin_levels_spreads_detail_levels_like_youtube():
    """너무 가까운 level 1은 level 2로, level 1·2는 level 3으로 낮추고, 4.5초 안의 문장은 뺀다(2026-11-12 크레페:
    상세도 2가 4.7초에 한 문장으로 유튜브의 두 배)."""
    scenes = [{"lines": [{"atMs": 0, "level": 1, "text": "a"}, {"atMs": 5000, "level": 1, "text": "b"}]},
              {"lines": [{"atMs": 10_000, "level": 1, "text": "c"}, {"atMs": 12_000, "level": 2, "text": "d"},
                         {"atMs": 15_000, "level": 2, "text": "e"}]}]
    local.thin_levels(scenes)
    got = [(x["text"], x["level"]) for sc in scenes for x in sc["lines"]]
    # b: level 1과 5초 → 2, 그런데 level 1·2와도 5초 → 3. c: 10초 뒤라 level 1. d: 2초 → 뺌. e: c와 5초 → level 3
    assert got == [("a", 1), ("b", 3), ("c", 1), ("e", 3)]
