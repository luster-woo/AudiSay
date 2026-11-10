"""안내 목소리(3차 이식): /internal/tts 저장·재사용·실패, 기호 지우기. H200·S3 없이(가짜 추론, 로컬 저장소)."""
from fastapi.testclient import TestClient

from app import inference, internal_api
from app.config import Settings
from app.storage import LocalStorage
from app.tts_text import normalize_ko


def _client(monkeypatch, tmp_path, inf):
    monkeypatch.setattr(internal_api, "settings", lambda: Settings(_env_file=None, ai_internal_token="secret"))
    monkeypatch.setattr(internal_api.inference, "for_chat", lambda cfg, feature: inf)
    from app.main import app

    app.state.storage = LocalStorage(str(tmp_path))
    app.state.db = None
    return TestClient(app)  # with 없이 만들어 lifespan(RabbitMQ 연결)을 돌리지 않는다


def test_tts_saves_once_and_reuses(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path, inference.MockInference())
    h = {"X-Internal-Token": "secret"}
    r = c.post("/internal/tts", json={"text": "▶ 🅰🅲 30초 뒤로 갔어요", "voice": "F1"}, headers=h)
    assert r.status_code == 200 and r.json()["cached"] is False and r.json()["durationMs"] == 1000
    key = r.json()["audioKey"]
    assert key.startswith("audio/guide/F1/") and (tmp_path / key).read_bytes() == b"ID3mock"
    again = c.post("/internal/tts", json={"text": "30초 뒤로 갔어요"}, headers=h).json()  # 기호를 지우면 같은 문장
    assert (again["audioKey"], again["cached"], again["durationMs"]) == (key, True, 1000)
    assert c.post("/internal/tts", json={"text": "🅰🅲"}, headers=h).status_code == 400  # 지우고 나면 빈 문장


def test_tts_off_or_failed_gives_empty_audio_url(monkeypatch, tmp_path):
    h = {"X-Internal-Token": "secret"}
    off = _client(monkeypatch, tmp_path, None).post("/internal/tts", json={"text": "안녕하세요"}, headers=h)
    assert off.status_code == 200 and off.json()["audioUrl"] is None and off.json()["reason"] == "TTS_002"  # FE는 브라우저 음성으로

    class Broken(inference.MockInference):
        async def tts(self, text, voice):
            raise inference.InferenceError("INFER_FAILED", "x")

    bad = _client(monkeypatch, tmp_path, Broken()).post("/internal/tts", json={"text": "안녕하세요"}, headers=h)
    assert bad.status_code == 200 and bad.json()["audioUrl"] is None and bad.json()["reason"] == "TTS_003"


def test_tts_chunks_stay_under_limit_and_keep_text():
    sentence = "다음 장면으로 넘어가려면 오른쪽 화살표를 누르세요."  # 27자
    text = " ".join([sentence] * 18)  # 503자
    chunks = internal_api.tts_chunks(text)
    assert all(len(c) <= 120 for c in chunks) and " ".join(chunks) == text
    assert all(c.endswith(".") for c in chunks)  # 문장 중간에서 끊지 않는다
    assert internal_api.tts_chunks("짧은 문장. 또 짧은 문장.") == ["짧은 문장. 또 짧은 문장."]  # 묶어서 한 번에
    comma = ", ".join(["왼쪽 화살표를 누르면 십 초 뒤로 가요"] * 6)  # 마침표 없이 긴 한 문장 → 쉼표에서
    assert all(len(c) <= 120 and c.endswith(("요", "요,")) for c in internal_api.tts_chunks(comma))
    assert [len(c) for c in internal_api.tts_chunks("가" * 250)] == [120, 120, 10]  # 띄어쓰기도 없으면 글자 수로


def test_tts_long_text_made_in_chunks(monkeypatch, tmp_path):
    sent: list[str] = []

    class Counting(inference.MockInference):
        async def tts(self, text, voice):
            sent.append(text)
            return await super().tts(text, voice)

    async def join(parts):
        return b"".join(parts)

    monkeypatch.setattr(internal_api, "_join_mp3", join)  # 진짜 mp3 잇기(ffmpeg)는 H200 실측에서 확인
    c = _client(monkeypatch, tmp_path, Counting())
    text = " ".join(["해설 목소리 크기는 설정에서 바꿀 수 있어요."] * 12)  # 300자
    r = c.post("/internal/tts", json={"text": text}, headers={"X-Internal-Token": "secret"}).json()
    assert r["audioKey"] and len(sent) == 3 and all(len(s) <= 120 for s in sent)
    assert r["durationMs"] == 3000 and (tmp_path / r["audioKey"]).read_bytes() == b"ID3mock" * 3


def test_normalize_reads_numbers_and_drops_symbols():
    assert normalize_ko("▶ 🅰🅲🅴 라바 시즌3 😂👍🏻") == "라바 시즌삼"
    assert normalize_ko("1½컵, 58% ❤️") == "한 컵 반, 오십팔퍼센트"


def test_normalize_reads_english_words_whole():
    """보통 영어 단어는 한글 발음으로 단어째, 약어만 알파벳으로(2026-11-03 데모: 제목 'Caminandes Llamigos'를 철자로 읽음)."""
    assert normalize_ko("Caminandes Llamigos") == "카미난데스 라미고스"
    assert normalize_ko("Shaun the Sheep") == "숀 더 쉽"
    assert normalize_ko("Pingu와 Larva") == "핑구와 라바"
    assert normalize_ko("TTS 시험") == "티티에스 시험"


def test_normalize_reads_ages_steps_tilde_and_lists():
    """2026-11-10 점검: '30대'·'3단계'·'~'를 잘못 읽고, 숫자 뒤 띄어쓰기를 지우던 것."""
    assert normalize_ko("30대 남성") == "삼십 대 남성"
    assert normalize_ko("3대의 차") == "세 대의 차"
    assert normalize_ko("글자 크기 3단계.") == "글자 크기 삼단계."
    assert normalize_ko("반가워요~") == "반가워요"
    assert normalize_ko("1~3초") == "일에서 삼 초"
    assert normalize_ko("1, 2, 3 하나씩") == "일, 이, 삼 하나씩"
    assert normalize_ko("10,000원") == "만 원"
