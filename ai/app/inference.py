"""H200 오픈소스 추론 서버(ai/gpu_server) 클라이언트. 데모 backend/app/pipeline/inference.py를 비동기(httpx.AsyncClient)로 옮겼다.

- remote: H200_BASE_URL로 부른다. SSH 터널이면 http://127.0.0.1:8100, 주피터 프록시면 https://<허브>/user/<이름>/proxy/8100
- mock: 연결 전·자동 시험용 가짜 응답(크레딧·GPU 0). 결과에 "시험용"이라고 표시한다
설정: INFERENCE_MODE=remote|mock (기본 mock), H200_BASE_URL, H200_TOKEN, H200_CHAT

약속(gpu_server/server.py와 같아야 함)
- POST /stt      wav 파일(+language) → {"segments": [{"startMs", "endMs", "text"}], "language", "model"}
- POST /ocr      jpg 여러 장 → {"texts": [[글자, ...], ...]}  (이미지 순서대로)
- POST /describe JSON {title, guide, scenes:[{startMs, endMs, transcript, ocr, frames:[base64 jpg]}]}
                 → {"scenes": [{"title", "people": [{name, basis, appearance}], "lines": [{"atMs", "level", "text"}]}], "model"}
- POST /story    JSON {title, guide, frames:[{atMs, jpg(base64)}], sounds, transcript}
                 → {"events": [{"atMs", "text"}], "names": [{"name", "what"}], "model"}  (영상 전체 줄거리·인물표, 32B)
- POST /summarize JSON {title, transcript, sceneTitles, lines} → {"summary", "category"(한국어 9종), "model"}
- POST /translate JSON {texts, source, title} → {"texts": [...], "model"}
- POST /chat/answer JSON {question, context} → {"sentences": [...], "model"}
- POST /chat/answer/stream 같은 요청 → 한 줄에 JSON 하나 {"sentence"} ... {"done": true, "model"}
- POST /chat/intent JSON {utterance} → {"intent", "target_time", "scene_query", "model"}
- POST /tts      JSON {text, voice, format:"mp3"} → audio/mpeg 바이트, 헤더 X-Duration-Ms (서버 버전 12, Supertonic 3)

H200 호출도 ai_call_logs에 남긴다(크레딧 0, 모델 이름 앞에 h200:). 걸린 시간 비교용.
"""
import base64
import json
import os
import time
from collections.abc import AsyncIterator
from pathlib import Path

import httpx

from app.config import Settings

CHAT_TIMEOUT = 3  # 질문 답변(H200 첫 문장 실측 0.4초). 다른 사람의 해설 만들기로 GPU가 막혀 늦으면 바로 GMS로(명세: 첫 이벤트 10초)
STT_TIMEOUT = 4  # 질문 녹음 받아쓰기. H200 실측 1~2초. 늦으면 GMS whisper(5초)로 → 합쳐서 Spring 제한 10초 안(명세)
INTENT_TIMEOUT = 2  # 발화 분석. 늦으면 GMS lite로 → Spring 제한 5초 안(명세)
JOB_TIMEOUT = 600
TTS_TIMEOUT = 5  # 안내 목소리 한 문장(H200 실측 0.04초). 이보다 늦으면 브라우저 음성으로 읽는 편이 빠르다
HEALTH_TIMEOUT = 5  # 일을 맡기기 전에 서버가 살아 있는지(/health). 터널·서버가 끊겼으면 바로 Gemini로 넘긴다
CHAT_FEATURES = ("stt", "intent", "answer", "tts")


class InferenceError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class MockInference:
    name = "mock"
    last_model = "mock"

    async def healthy(self) -> bool:
        return True

    async def transcribe(self, wav: Path | None) -> dict:
        return {"segments": [], "model": "mock"}

    async def transcribe_bytes(self, wav: bytes, hint: str = "") -> dict:
        return {"segments": [{"startMs": 0, "endMs": 1000, "text": "시험용 받아쓰기"}], "model": "mock"}

    async def ocr(self, images: list[Path]) -> dict:
        return {"texts": [[] for _ in images]}

    async def describe(self, payload: dict) -> dict:
        out = []
        for i, s in enumerate(payload["scenes"]):
            out.append({"title": f"{i + 1}번째 장면(시험용)", "people": [],
                        "lines": [{"atMs": s["startMs"] + 300, "level": 1, "text": f"시험용 해설입니다. {i + 1}번째 장면이 시작됩니다."},
                                  {"atMs": s["startMs"] + 2500, "level": 2, "text": "추론 서버를 연결하면 실제 해설로 바뀝니다."}]})
        return {"scenes": out, "model": "mock"}

    async def describe_video(self, mp4: Path, prompt: str, schema: dict) -> dict:
        return {"model": "mock", "result": {
            "category": "기타", "summary_30s": "시험용 요약입니다.", "dialogue": [],
            "scenes": [{"start": "00:00", "end": "00:02", "title": "시험용 장면", "people": [], "screen_text": []}],
            "lines": [{"at": "00:00", "level": 1, "text": "시험용 해설입니다. 영상 보기 경로입니다."}]}}

    async def generate_json(self, prompt: str, schema: dict, max_tokens: int = 2000, images: list[str] | None = None) -> dict:
        return {"model": "mock", "result": {"chapters": [{"start": "00:00", "title": "시험용 장면"}], "items": []}}

    async def faces(self, mp4: Path) -> dict:
        return {"persons": [], "frames": [], "width": 960, "model": "mock"}

    async def sounds(self, wav: Path | None) -> dict:
        return {"events": [], "model": "mock"}

    async def speakers(self, wav: Path | None, segs: list[dict]) -> dict:
        return {"speakers": [], "model": "mock"}

    async def story(self, payload: dict) -> dict:
        return {"events": [], "names": [], "model": "mock"}

    async def summarize(self, payload: dict) -> dict:
        return {"summary": f"{payload['title']} 영상의 시험용 요약입니다. 추론 서버를 연결하면 실제 요약이 나옵니다.",
                "category": "기타", "model": "mock"}

    async def translate(self, texts: list[str], source: str | None = None, title: str | None = None) -> dict:
        return {"texts": [f"(번역) {t}" for t in texts], "model": "mock"}

    async def answer(self, question: str, context: dict) -> dict:
        return {"sentences": ["시험용 답변입니다."], "model": "mock"}

    async def intent(self, utterance: str) -> dict:
        return {"intent": "QUESTION", "model": "mock"}

    async def tts(self, text: str, voice: str) -> tuple[bytes, int]:
        return b"ID3mock", 1000


class RemoteInference:
    name = "remote"

    def __init__(self, base_url: str, token: str, stream_answer: bool = True):
        self.base = base_url.rstrip("/")
        self.headers = {"Authorization": f"token {token}"} if token else {}  # 토큰은 로그·응답에 남기지 않는다
        self.stream_answer = stream_answer
        self.last_model = ""

    async def healthy(self) -> bool:
        """/health가 ok면 True. 연결이 안 되거나 늦거나 오류면 False(예외를 내지 않는다)."""
        try:
            async with httpx.AsyncClient(timeout=HEALTH_TIMEOUT) as c:
                r = await c.get(f"{self.base}/health", headers=self.headers)
            return r.status_code == 200 and bool(r.json().get("ok"))
        except (httpx.HTTPError, ValueError):
            return False

    async def _post(self, path: str, timeout: float = JOB_TIMEOUT, **kw) -> dict:
        try:
            async with httpx.AsyncClient(timeout=timeout) as c:
                r = await c.post(f"{self.base}{path}", headers=self.headers, **kw)
        except httpx.HTTPError as e:
            raise InferenceError("INFER_UNREACHABLE", f"추론 서버에 연결하지 못했어요: {type(e).__name__}") from None
        if r.status_code != 200:
            # 서버가 알려 준 까닭(깨진 JSON의 finish_reason·끝부분 등)을 붙인다. 502만으로는 왜 실패했는지 몰랐다
            raise InferenceError("INFER_FAILED", f"추론 서버 오류 {r.status_code} {r.text[:400]}")
        try:
            return r.json()
        except ValueError:
            raise InferenceError("INFER_FAILED", "추론 서버 응답을 읽지 못했어요(로그인 화면으로 넘어갔을 수 있음)") from None

    async def transcribe(self, wav: Path | None) -> dict:
        if not wav:
            return {"segments": [], "model": "none"}
        # 업로드 영상은 외국어일 수 있어 언어 자동 감지
        return await self._post("/stt", files={"audio": (wav.name, wav.read_bytes(), "audio/wav")}, data={"language": "auto"})

    async def transcribe_bytes(self, wav: bytes, hint: str = "") -> dict:
        """녹음 한 토막(16kHz mono wav). 질문 녹음은 짧으니 오래 기다리지 않는다. hint는 받아쓰기 힌트(서버 버전 13, 옛 서버는 무시)."""
        return await self._post("/stt", timeout=STT_TIMEOUT, files={"audio": ("q.wav", wav, "audio/wav")}, data={"prompt": hint})

    async def ocr(self, images: list[Path]) -> dict:
        files = [("images", (p.name, p.read_bytes(), "image/jpeg")) for p in images]
        return await self._post("/ocr", files=files)

    async def describe(self, payload: dict) -> dict:
        body = {**payload, "scenes": [{**s, "frames": [base64.b64encode(Path(p).read_bytes()).decode() for p in s["frames"]]}
                                      for s in payload["scenes"]]}
        return await self._post("/describe", json=body)

    async def summarize(self, payload: dict) -> dict:
        return await self._post("/summarize", json=payload)

    # ---------- 업로드 영상 32B 영상 보기 엔진(app/pipeline/video.py, H200 gpu_server 버전 22) ----------
    async def describe_video(self, mp4: Path, prompt: str, schema: dict) -> dict:
        """저해상도 영상 + 프롬프트 + JSON 스키마 → {"result", "model"}(32B). 32B가 꺼져 있으면 실패."""
        return await self._post("/describe_video", timeout=1300, files={"video": (mp4.name, mp4.read_bytes(), "video/mp4")},
                                data={"prompt": prompt, "schema": json.dumps(schema, ensure_ascii=False)})

    async def generate_json(self, prompt: str, schema: dict, max_tokens: int = 2000, images: list[str] | None = None) -> dict:
        """글(과 사진 몇 장)으로 32B에 JSON 하나(장면 목차·호칭·상황 흐름 등). 사진은 서버 버전 23(얼굴 사진 모음)."""
        body = {"prompt": prompt, "json_schema": schema, "max_tokens": max_tokens}
        if images:
            body["images"] = images
        return await self._post("/generate_json", timeout=600, json=body)

    async def faces(self, mp4: Path) -> dict:
        """960px·초당 2장 사본 → 얼굴로 묶은 사람(P1…)과 장마다 얼굴 위치(서버 버전 23). 옛 서버면 실패."""
        return await self._post("/faces", timeout=900, files={"video": (mp4.name, mp4.read_bytes(), "video/mp4")})

    async def sounds(self, wav: Path | None) -> dict:
        """효과음·음악 구간. 소리가 없거나 옛 서버면 빈 목록(해설은 계속 만든다)."""
        if not wav:
            return {"events": [], "model": None}
        try:
            return await self._post("/sounds", files={"audio": (wav.name, wav.read_bytes(), "audio/wav")})
        except InferenceError:
            return {"events": [], "model": None}

    async def speakers(self, wav: Path | None, segs: list[dict]) -> dict:
        """{"speakers": 대사 줄마다 화자 번호(목소리로 나눔), "model"}. 소리가 없거나 옛 서버면 빈 목록(화자 없이 계속)."""
        if not wav or not segs:
            return {"speakers": [], "model": None}
        try:
            # WeSpeaker(서버 버전 23). wavlm은 짧은 한국어 대사에서 남녀를 한 화자로 묶었다. 잘게 나눠도 상황 파악이 다시 묶는다
            r = await self._post("/speakers", files={"audio": (wav.name, wav.read_bytes(), "audio/wav")},
                                 data={"segments": json.dumps([{"startMs": x["startMs"], "endMs": x["endMs"]} for x in segs]),
                                       "model": os.getenv("SPEAKER_MODEL", "wespeaker"), "same": os.getenv("SPEAKER_SAME", "0.5")})
            return r if len(r.get("speakers", [])) == len(segs) else {"speakers": [], "model": None}
        except InferenceError:
            return {"speakers": [], "model": None}

    async def story(self, payload: dict) -> dict:
        """영상 전체 사진(3초 간격) + 소리·대사 → 핵심 사건과 인물·물건 이름(32B). 옛 서버거나 32B가 꺼져 있으면
        빈 결과(장면별 해설만으로 계속)."""
        body = {**payload, "frames": [{"atMs": at, "jpg": base64.b64encode(Path(p).read_bytes()).decode()}
                                      for at, p in payload["frames"]]}
        try:
            return await self._post("/story", json=body)
        except InferenceError:
            return {"events": [], "names": [], "model": "none"}

    async def translate(self, texts: list[str], source: str | None = None, title: str | None = None) -> dict:
        """외국어 대사 → 한국어. 제목은 고유명사·주제 맥락."""
        return await self._post("/translate", json={"texts": texts, "source": source, "title": title})

    async def answer(self, question: str, context: dict) -> dict:
        return await self._post("/chat/answer", timeout=CHAT_TIMEOUT, json={"question": question, "context": context})

    async def answer_stream(self, question: str, context: dict) -> AsyncIterator[str]:
        """문장이 완성되는 대로 하나씩 낸다. 옛 서버(404)나 연결 실패는 InferenceError."""
        try:
            async with httpx.AsyncClient(timeout=CHAT_TIMEOUT) as c, c.stream(
                    "POST", f"{self.base}/chat/answer/stream", headers=self.headers,
                    json={"question": question, "context": context}) as r:
                if r.status_code != 200:
                    raise InferenceError("INFER_NO_STREAM", f"추론 서버 스트리밍 없음 {r.status_code}")
                async for line in r.aiter_lines():
                    if not line.strip():
                        continue
                    j = json.loads(line)
                    if j.get("sentence"):
                        yield j["sentence"]
                    if j.get("done"):
                        self.last_model = j.get("model", "")
        except httpx.HTTPError as e:
            raise InferenceError("INFER_UNREACHABLE", f"추론 서버에 연결하지 못했어요: {type(e).__name__}") from None
        except ValueError:
            raise InferenceError("INFER_FAILED", "추론 서버 스트리밍 응답을 읽지 못했어요") from None

    async def intent(self, utterance: str) -> dict:
        return await self._post("/chat/intent", timeout=INTENT_TIMEOUT, json={"utterance": utterance})

    async def tts(self, text: str, voice: str) -> tuple[bytes, int]:
        """안내 목소리 한 문장(서버 버전 12) → (mp3 바이트, 길이 ms). 늦으면 브라우저 음성이 낫기 때문에 오래 기다리지 않는다."""
        try:
            async with httpx.AsyncClient(timeout=TTS_TIMEOUT) as c:
                r = await c.post(f"{self.base}/tts", headers=self.headers, json={"text": text, "voice": voice, "format": "mp3"})
        except httpx.HTTPError as e:
            raise InferenceError("INFER_UNREACHABLE", f"추론 서버에 연결하지 못했어요: {type(e).__name__}") from None
        if r.status_code != 200 or not r.headers.get("content-type", "").startswith("audio/"):
            raise InferenceError("INFER_FAILED", f"추론 서버 음성 오류 {r.status_code}")
        return r.content, int(r.headers.get("x-duration-ms", "0"))


Inference = MockInference | RemoteInference


def make(cfg: Settings) -> Inference:
    """업로드 영상 분석용. remote인데 주소가 없으면 설정 오류."""
    if cfg.inference_mode == "remote":
        if not cfg.h200_base_url:
            raise InferenceError("INFER_CONFIG", "H200_BASE_URL이 없습니다. .env에 넣어 주세요.")
        return RemoteInference(cfg.h200_base_url, cfg.h200_token, cfg.h200_answer_stream)
    return MockInference()


def for_chat(cfg: Settings, feature: str) -> RemoteInference | None:
    """재생 중 기능용. remote 모드이고 주소가 있고 그 기능(stt·intent·answer·tts)이 H200_CHAT에 들어 있을 때만. 아니면 None(GMS로)."""
    if cfg.inference_mode != "remote" or not cfg.h200_base_url:
        return None
    if feature not in [x.strip() for x in cfg.h200_chat.split(",") if x.strip()]:
        return None
    return RemoteInference(cfg.h200_base_url, cfg.h200_token, cfg.h200_answer_stream)


async def log_remote(db, purpose: str, model: str, t0: float, chat_log_id: int | None = None, job_id: int | None = None,
                     error: str | None = None) -> None:
    """H200 호출을 ai_call_logs에 남긴다(크레딧 0). db가 없으면 건너뛴다."""
    if db is None:
        return
    from app.db import CallLog
    await db.log_call(CallLog(purpose=purpose, model=f"h200:{model}"[:50], latency_ms=int((time.monotonic() - t0) * 1000),
                              error_code=error, job_id=job_id, chat_log_id=chat_log_id))
