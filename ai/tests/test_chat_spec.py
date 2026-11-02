"""AI 서버 내부 명세서 3·4번: 장면 고르기 응답, 질문 답변 SSE(delta·sentence·done), 답변 음성, 409. DB·GMS·S3 없이."""
import json

from fastapi.testclient import TestClient

from app import internal_api
from app.chat import seek as sk
from app.config import Settings
from app.storage import LocalStorage

H = {"X-Internal-Token": "secret"}
CHAPTERS = [{"chapterId": 41, "title": "전반전", "startMs": 0, "endMs": 190_000, "summary": "전반 20분, 손흥민의 왼발 선제골",
             "keywords": ["골", "손흥민"]},
            {"chapterId": 42, "title": "후반전", "startMs": 190_000, "endMs": 400_000, "summary": "교체 투입", "keywords": ["교체"]}]


def _client(monkeypatch, tmp_path, chapters=CHAPTERS, gms=None):
    monkeypatch.setattr(internal_api, "settings", lambda: Settings(_env_file=None, ai_internal_token="secret"))
    monkeypatch.setattr(internal_api, "_pool", lambda request: object())
    monkeypatch.setattr(internal_api, "_gms", lambda request: gms)
    monkeypatch.setattr(internal_api.inference, "for_chat", lambda cfg, feature: None)

    async def chapters_of(pool, description_id):
        return chapters

    monkeypatch.setattr(sk, "chapters_of", chapters_of)
    from app.main import app

    app.state.db, app.state.redis, app.state.storage = None, None, LocalStorage(str(tmp_path))
    return TestClient(app)


def test_seek_returns_candidates_with_summary(monkeypatch, tmp_path):
    r = _client(monkeypatch, tmp_path).post("/internal/chat/seek", json={"descriptionId": 20, "query": "골 넣는 장면"}, headers=H)
    assert r.json() == {"candidates": [{"chapterId": 41, "title": "전반전", "startMs": 0, "summary": "전반 20분, 손흥민의 왼발 선제골"}]}
    empty = _client(monkeypatch, tmp_path, chapters=[]).post("/internal/chat/seek", json={"descriptionId": 20, "query": "골"}, headers=H)
    assert empty.status_code == 200 and empty.json() == {"candidates": []}


async def test_seek_ai_picks_up_to_three_in_order():
    class Gms:
        async def generate(self, model, contents, cfg, ctx):
            return type("R", (), {"text": '{"n": [2, 1, 2, 9]}'})()

    picked = await sk.by_ai(Gms(), "교체", CHAPTERS)
    assert [c["chapterId"] for c in picked] == [42, 41]  # 중복·없는 번호는 뺀다


def _events(body: str) -> list[tuple[str, dict]]:
    out = []
    for block in body.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        out.append((lines["event"], json.loads(lines["data"])))
    return out


def _answer_client(monkeypatch, tmp_path, sentences, gms=None):
    c = _client(monkeypatch, tmp_path, gms=gms)

    async def context(pool, description_id, t_ms):
        return {}

    async def pick(gms, req, ctx, inf=None, db=None):
        return internal_api._aiter(sentences)

    monkeypatch.setattr(internal_api.ans, "context", context)
    monkeypatch.setattr(internal_api, "_pick_answer", pick)
    return c


REQ = {"chatLogId": 88, "descriptionId": 20, "videoTimeMs": 197_000, "utterance": "방금 누가 골 넣었어?", "intent": "QUESTION"}


def test_answer_streams_sse_per_spec(monkeypatch, tmp_path):
    c = _answer_client(monkeypatch, tmp_path, ["손흥민 선수가 넣었어요.", "왼발 슛이었어요."])
    r = c.post("/internal/chat/answer", json=REQ, headers=H)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    ev = _events(r.text)
    assert [e for e, _ in ev] == ["delta", "sentence", "delta", "sentence", "done"]
    assert ev[1][1] == {"index": 0, "text": "손흥민 선수가 넣었어요.", "audioUrl": None}  # GMS 없으면 음성 없음 → 브라우저 음성
    done = ev[-1][1]
    assert done["answerText"] == "손흥민 선수가 넣었어요. 왼발 슛이었어요." and done["answerSource"] == "STORED"
    assert set(done) == {"answerText", "answerSource", "firstAudioMs", "totalLatencyMs"}


def test_answer_unanswerable_and_conflict(monkeypatch, tmp_path):
    c = _answer_client(monkeypatch, tmp_path, [internal_api.ans.UNANSWERABLE + "."])
    assert _events(c.post("/internal/chat/answer", json=REQ, headers=H).text)[-1][1]["answerSource"] == "UNANSWERABLE"
    internal_api._answering.add(88)  # 같은 chatLogId가 처리 중
    try:
        r = c.post("/internal/chat/answer", json=REQ, headers=H)
        assert r.status_code == 409 and r.json()["detail"]["code"] == "CHAT_IN_PROGRESS"
    finally:
        internal_api._answering.discard(88)


async def test_sentence_audio_goes_to_s3_with_presigned_url(monkeypatch, tmp_path):
    from app.pipeline import tts as tts_pipe

    async def synth(gms, text, ctx):
        assert ctx.purpose == "TTS" and ctx.chat_log_id == 88
        return b"ID3mp3", 900

    class Store(LocalStorage):
        async def presign(self, key, expires_sec):
            assert expires_sec == 6 * 3600
            return f"https://s3/{key}?sig"

    monkeypatch.setattr(tts_pipe, "synthesize", synth)
    url = await internal_api._sentence_audio(object(), Store(str(tmp_path)), 88, 1, "왼발 슛이었어요.")
    assert url == "https://s3/tts/chat/88/1.mp3?sig" and (tmp_path / "tts/chat/88/1.mp3").read_bytes() == b"ID3mp3"
