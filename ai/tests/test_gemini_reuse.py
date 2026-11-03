"""Gemini 결과 재사용(2026-11-02): 레포에 넣어 둔 데모 결과·S3 캐시가 있으면 Gemini를 부르지 않는다 (크레딧 0)."""
import json

from app.mq.envelope import Envelope
from app.pipeline.prepare import GEMINI_SEED_DIR, Prepare, gemini_cache_key, youtube_id
from app.storage import LocalStorage
from tests.test_handlers import FakeEvents, FakeGms


def env(job_id: int, url: str, duration: int = 207) -> Envelope:
    return Envelope(messageId=f"p{job_id}", type="JOB_PREPARE", jobId=job_id, payload={
        "videoId": 58, "pipeline": "GEMINI_URL", "youtubeUrl": url, "originalKey": None,
        "durationSec": duration, "title": "시험", "chunkSec": 120})


def test_youtube_id():
    assert youtube_id("https://www.youtube.com/watch?v=to3sjq-CAvA&t=3") == "to3sjq-CAvA"
    assert youtube_id("https://youtu.be/to3sjq-CAvA") == youtube_id("https://www.youtube.com/shorts/to3sjq-CAvA") == "to3sjq-CAvA"
    assert youtube_id("https://example.com/a") is None


async def test_seeded_demo_result_skips_gemini(tmp_path):
    assert (GEMINI_SEED_DIR / "to3sjq-CAvA.json").exists()  # 데모에서 만든 노래 영상(유리의 숲)
    storage, gms, ev = LocalStorage(str(tmp_path)), FakeGms(), FakeEvents()
    await Prepare(storage, gms)(env(31, "https://www.youtube.com/watch?v=to3sjq-CAvA"), ev)
    full = json.loads((tmp_path / "jobs/31/full.json").read_text(encoding="utf-8"))
    assert gms.calls == 0 and full["model"] == "gemini-3.5-flash" and full["lines"]
    assert ev.sent[-1][0] == "STAGE_COMPLETED"


async def test_new_result_is_cached_for_next_job(tmp_path):
    storage, gms = LocalStorage(str(tmp_path)), FakeGms()
    url = "https://www.youtube.com/watch?v=AAAAAAAAAAA"  # 레포에 없는 영상
    await Prepare(storage, gms)(env(31, url, 190), FakeEvents())
    assert gms.calls == 1 and (tmp_path / gemini_cache_key("AAAAAAAAAAA")).exists()
    await Prepare(storage, gms)(env(32, url, 190), FakeEvents())  # 다른 작업이 같은 영상을 요청
    assert gms.calls == 1 and (tmp_path / "jobs/32/full.json").exists()


def test_cache_key_has_prompt_version():
    """프롬프트를 고치면 같은 영상도 새로 받는다(2026-11-03 데모: 11/2 프롬프트 결과를 계속 씀)."""
    from app.pipeline.narration_schema import PROMPT_VERSION

    assert gemini_cache_key("to3sjq-CAvA") == f"cache/gemini/to3sjq-CAvA_p{PROMPT_VERSION}.json"
