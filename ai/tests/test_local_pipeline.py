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
    kept = local.cap_lines(lines, 12_000)  # 12초 → 2문장
    assert [x["text"] for x in kept] == ["가", "라"]  # level 1은 한도의 절반(1), 나머지는 낮은 level부터, 같은 문장은 하나
    assert len(local.cap_lines(lines, 1000)) == 1


def test_group_sentences_by_end_mark_or_12s():
    segs = [{"startMs": 0, "endMs": 2000, "text": "Add five garlic"}, {"startMs": 2000, "endMs": 4000, "text": "cloves."},
            {"startMs": 4000, "endMs": 10_000, "text": "Then stir"}, {"startMs": 10_000, "endMs": 17_000, "text": "slowly and"},
            {"startMs": 17_000, "endMs": 18_000, "text": "wait"}]
    g = local.group_sentences(segs)
    assert [x["text"] for x in g] == ["Add five garlic cloves.", "Then stir slowly and", "wait"]
    assert (g[1]["startMs"], g[1]["endMs"]) == (4000, 17_000)


def test_split_scenes_merges_short_and_splits_long():
    cuts = [(0, 10_000), (10_000, 12_000), (12_000, 80_000)]
    assert local.split_scenes(cuts, 80_000) == [{"startMs": 0, "endMs": 12_000}, {"startMs": 12_000, "endMs": 42_000},
                                                {"startMs": 42_000, "endMs": 72_000}, {"startMs": 72_000, "endMs": 80_000}]


def test_frames_for_and_overlaps():
    assert local.frames_for(3000) == 4 and local.frames_for(36_000) == 6 and local.frames_for(120_000) == 8
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
                 "lines": [{"atMs": 500, "level": 1, "text": "양파가 냄비에 들어가 있음"}, {"atMs": 2000, "level": 3, "text": "냄비가 빨갛습니다"}]},
                {"title": "볶기", "people": [], "lines": [{"atMs": 25_000, "level": 1, "text": "주걱으로 볶습니다"}]}]}

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


def test_ground_names_keeps_only_names_with_evidence(monkeypatch):
    names = [{"name": "철수", "what": "빨간 모자 남성"}, {"name": "영희", "what": "안경 쓴 여성"}, {"name": "민수", "what": ""}]
    segs = [{"text": "영희야 이리 와"}]
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
