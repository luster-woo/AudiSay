"""업로드 영상 32B 영상 보기 엔진(app/pipeline/video.py, 데모 2026-11-04에서 옮김)의 순수 부분과 merge 연결."""
import asyncio

from app.pipeline import local, video
from app.pipeline.merge import assemble


def test_long_video_is_split_into_one_minute_parts():
    # 1분 반까지는 통째로, 그보다 길면 1분 조각(끝에 20초보다 짧게 남으면 앞 조각에 붙임)
    assert video.chunk_spans(90_000) == [(0, 90_000)]
    assert video.chunk_spans(181_000) == [(0, 60_000), (60_000, 120_000), (120_000, 181_000)]
    assert len(video.chunk_spans(448_000)) == 8


def test_invented_names_become_dialogue_names_or_labels():
    """32B가 딸 "금명"을 "김금명", 아빠를 "김철수"로 지어냈다(데모 폭싹 속았수다). 호칭("빵 이발사")·낱말("입장")은 그대로."""
    asked = []

    class Fake:
        async def generate_json(self, prompt, schema, max_tokens=2000):
            asked.append(prompt)
            return {"result": {"items": [{"name": "김철수", "label": "아빠"}]}, "model": "32B"}

    raw = {"summary_30s": "김금명이 결혼한다.", "lines": [{"text": "김철수가 김금명의 손을 잡는다."}],
           "scenes": [{"title": "결혼식", "screen_text": [],
                       "people": [{"name": "김금명", "appearance": "신부"}, {"name": "김철수", "appearance": "정장"},
                                  {"name": "김철수(어린 시절)", "appearance": "청년"}, {"name": "빵 이발사", "appearance": "빵"},
                                  {"name": "입장", "appearance": "?"}]}]}
    segs = [{"startMs": 0, "endMs": 1000, "text": "금명아, 아빠 여기 있어", "who": "김철수"}]
    voices = {"화자1": "김철수"}
    renames, model = asyncio.run(video.fix_names(Fake(), raw, segs, voices, "그물이 되어준 아빠"))
    assert renames == {"김금명": "금명", "김철수": "아빠", "김철수(어린 시절)": "아빠"} and model == "32B"
    assert raw["lines"][0]["text"] == "아빠가 금명의 손을 잡는다." and raw["summary_30s"] == "금명이 결혼한다."
    assert voices == {"화자1": "아빠"} and segs[0]["who"] == "아빠"
    assert "빵 이발사" not in asked[0] and "입장" not in asked[0]


def test_name_notes_become_time_phrases():
    raw = {"lines": [{"text": "금명(어린 시절)이 아빠와 식탁에 앉아 있다."}, {"text": "화면에 (주)넷플릭스 로고"}],
           "scenes": [{"title": "금명(어린 시절)의 등굣길", "people": [{"name": "금명(어린 시절)"}]}], "summary_30s": ""}
    video.unbracket_names(raw)
    assert [x["text"] for x in raw["lines"]] == ["어린 시절, 금명이 아빠와 식탁에 앉아 있다.", "화면에 (주)넷플릭스 로고"]
    assert raw["scenes"][0]["people"][0]["name"] == "금명"


def test_speakers_are_matched_to_cast_by_majority():
    segs = [{"text": "다 됐습니다", "who": "화자1"}, {"text": "해주세요", "who": "화자3"}]
    casts = [[{"name": "이발사", "voices": ["화자1"]}, {"name": "큰머리 컵케이크", "voices": ["화자3"]}],
             [{"name": "초코", "voices": ["화자3"]}], [{"name": "큰머리 컵케이크", "voices": ["화자3"]}]]
    assert video.match_voices(casts, segs) == {"화자1": "이발사", "화자3": "큰머리 컵케이크"}
    assert [video.said(s) for s in segs] == ["[이발사] 다 됐습니다", "[큰머리 컵케이크] 해주세요"]


def test_merge_uses_story_chapters_and_voice_matched_labels():
    """32B가 고른 메인 장면이 있으면 장면마다 목차 대신 그것으로(첫 목차는 0초부터), 목소리로 짝지은 호칭은 인물로 남긴다."""
    full = {"durationMs": 60_000, "category": "ANIMATION", "summary30s": "요약", "model": "local-video:32B",
            "title": "큰머리 컵케이크", "voiceNames": ["빵 이발사", "김진수"],
            "chapters": [{"startMs": 2000, "title": "큰머리 컵케이크가 태어난다"}, {"startMs": 40_000, "title": "이발소를 찾아간다"}],
            "dialogues": [{"startMs": 1000, "endMs": 2000, "speaker": "빵 이발사", "text": "이발사님 고맙습니다"}],
            "scenes": [{"startMs": 0, "endMs": 20_000, "title": "빵집", "screenTexts": [],
                        "people": [{"name": "빵 이발사", "basis": None, "appearance": "빵"},
                                   {"name": "김진수", "basis": None, "appearance": "?"}]},
                       {"startMs": 20_000, "endMs": 60_000, "title": "이발소", "people": [], "screenTexts": []}],
            "lines": []}
    chunk = {"chunkIndex": 0, "lines": [{"detailLevel": 1, "startMs": 45_000, "gapEndMs": None, "importance": 3,
                                         "text": "컵케이크가 이발소 문을 연다.", "flags": []}], "screenTexts": []}
    plan = assemble(full, [chunk])
    assert [(c["startMs"], c["endMs"], c["title"]) for c in plan.chapters] == [
        (0, 40_000, "큰머리 컵케이크가 태어난다"), (40_000, 60_000, "이발소를 찾아간다")]
    assert plan.chapters[1]["summary"] == "컵케이크가 이발소 문을 연다." and len(plan.scenes) == 2
    assert [c["name"] for c in plan.characters] == ["빵 이발사"]  # 지어낸 "김진수"는 짝지어져도 뺌


def test_video_engine_falls_back_to_opensource(monkeypatch):
    """UPLOAD_ENGINE=video가 실패하면(32B 꺼짐 등) 장면별 오픈소스 엔진으로 넘어간다."""
    from app import inference

    async def broken(*a, **k):
        raise inference.InferenceError("INFER_FAILED", "32B 꺼짐")

    async def opensource(*a, **k):
        return {"category": "기타"}, "local:8B"

    monkeypatch.setattr(video, "analyze_video", broken)
    monkeypatch.setattr(local, "analyze_opensource", opensource)
    raw, model, errors = asyncio.run(local.analyze("video", None, None, False, "t", {}, None, 1000, None, 1))
    assert model == "local:8B (대체)" and errors == ["video: INFER_FAILED"]
