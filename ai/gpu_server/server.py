"""AudiSay 오픈소스 추론 서버(H200 주피터에서 실행). 노트북 데모 서버가 jupyter-server-proxy를 거쳐 부른다.

모델(예전 PoC에서 검증한 조합, AI 테스트/results/report.md)
- 받아쓰기: faster-whisper large-v3-turbo(int8_float16, VAD) — PoC CER 0.46%
- 화면 글자: PaddleOCR korean(PP-OCRv5) — PoC CER 2.9%
- 장면 해설·요약·질문 답변·발화 분석: Qwen3-VL(글만으로도 대화 가능 → 모델 하나만 올림). 기본 8B(가정, 32B도 시험 가능)

실행: uvicorn server:app --host 127.0.0.1 --port 8100   (밖으로 열지 않는다. 노트북은 SSH 터널로, 요청마다 .secret 비밀값 확인)
약속(노트북 backend/app/pipeline/inference.py와 같아야 함):
  /health, /warmup, /stt, /ocr, /describe, /summarize, /chat/answer, /chat/answer/stream, /chat/intent, /tts(버전 12)

버전 2(2026-10-28): 해설을 완결 문장으로, 장면 여러 개를 한 번에 묶어 생성(DESCRIBE_BATCH), 질문 답변 스트리밍
"""
import base64
import hmac
import io
import json
import os
import re
import tempfile
import threading
import time
from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

VERSION = 13
VLM_REPO = os.getenv("VLM_REPO", "Qwen/Qwen3-VL-8B-Instruct")
WHISPER_REPO = os.getenv("WHISPER_REPO", "deepdml/faster-whisper-large-v3-turbo-ct2")
DEVICE = os.getenv("DEVICE", "cuda:0")
DESCRIBE_BATCH = int(os.getenv("DESCRIBE_BATCH", "1"))  # 장면 몇 개를 한 번에 생성하나. 실측(2026-10-28) 4개 묶음이 하나씩보다 3배 느리고
# 문장이 장면 끝에 몰려 기본은 1. 큰 모델·vLLM으로 바꾸면 다시 시험
READ_MS_PER_CHAR, READ_BASE_MS = 182, 900  # 해설 읽는 시간 추정(Gemini TTS 실측), 문장 사이 간격에 쓴다

app = FastAPI(title="AudiSay GPU inference")
# 버전 10: 같은 서버의 다른 계정도 127.0.0.1:8100에 붙을 수 있어 비밀값을 확인한다. 노트북은 .env의 H200_TOKEN을
# "Authorization: token <값>"으로 보낸다. 비밀값은 .secret 파일(권한 600)에서 읽고, 파일이 없으면 확인하지 않는다
_secret_file = Path(__file__).with_name(".secret")
SECRET = _secret_file.read_text().strip() if _secret_file.exists() else ""


@app.middleware("http")
async def check_secret(request, call_next):
    if SECRET and not hmac.compare_digest(request.headers.get("authorization", ""), f"token {SECRET}"):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    return await call_next(request)


_lock = threading.Lock()  # GPU 모델 하나를 여러 요청이 동시에 쓰지 않게
# 버전 3: 언어 모델 생성은 상주 작업자 스레드 하나에서만 돌린다. PyTorch는 스레드마다 CUDA 준비(cuBLAS 핸들 등)를 새로 하므로
# 요청마다 새 스레드(스트리밍)나 매번 다른 스레드풀 스레드에서 돌리면 호출마다 약 2.8초를 더 썼다(2026-10-28 실측: 8토큰이
# 같은 스레드 0.16초, 새 스레드 2.92초). 작업자 스레드 하나에 모으면 첫 호출 뒤로는 늘 예열된 상태다.
from concurrent.futures import ThreadPoolExecutor
_gpu = ThreadPoolExecutor(max_workers=1, thread_name_prefix="gpu")


def on_gpu(fn, *args, **kwargs):
    """fn을 GPU 작업자 스레드에서 실행하고 결과를 기다린다(예외도 그대로 전달)."""
    return _gpu.submit(fn, *args, **kwargs).result()
_models: dict = {}
_stats = {"started": time.time(), "calls": {}}


def _count(name: str, t0: float) -> None:
    c = _stats["calls"].setdefault(name, {"n": 0, "sec": 0.0})
    c["n"] += 1
    c["sec"] = round(c["sec"] + time.time() - t0, 2)


# ---------- 모델 불러오기(처음 쓸 때 한 번) ----------
def whisper():
    if "whisper" not in _models:
        from faster_whisper import WhisperModel
        _models["whisper"] = WhisperModel(WHISPER_REPO, device="cuda", compute_type="int8_float16")
    return _models["whisper"]


def ocr_engine():
    if "ocr" not in _models:
        os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
        import paddle
        from paddleocr import PaddleOCR
        dev = "gpu:0" if paddle.device.is_compiled_with_cuda() else "cpu"
        _models["ocr"] = PaddleOCR(lang="korean", device=dev, use_doc_orientation_classify=False,
                                   use_doc_unwarping=False, use_textline_orientation=False)
        _models["ocr_device"] = dev
    return _models["ocr"]


# ---------- 버전 12: 안내 목소리(Supertonic 3, ONNX) ----------
# 질문 답·명령 응답·안내 문장을 사용자 수와 상관없이 GPU에서 문장당 약 0.04초에 만든다(2026-10-30 H200 실측, CPU는 0.6~1.5초).
# 그냥 돌리면 새 문장마다 1.6초(cuDNN이 크기가 바뀔 때마다 계산 방법을 다시 찾음) → 크기별 세션(tts_bucket.py)으로 해결.
# Qwen·Whisper가 쓰는 _lock과 따로 잠근다: 다른 사람의 해설 만들기(몇 분)가 GPU 잠금을 잡고 있어도 "5초 뒤로" 안내는 기다리지 않는다.
# onnxruntime-gpu는 CUDA 12용 1.23.x(이 서버 torch가 CUDA 12.8). 1.24부터는 CUDA 13을 찾아 GPU를 못 잡고 CPU로 돈다.
TTS_VOICES = {f"{g}{i}" for g in "FM" for i in range(1, 6)}
TTS_STEPS = int(os.getenv("TTS_STEPS", "5"))  # 노트북과 같은 값(기본 8 → 5, 약 30% 빠름)
_tts_lock = threading.Lock()


def tts_engine():
    if "tts" not in _models:
        import onnxruntime as ort
        try:
            ort.preload_dlls()  # pip로 깔린 CUDA·cuDNN 라이브러리를 먼저 불러온다
        except Exception:  # noqa: BLE001
            pass
        import supertonic.config as sc
        import supertonic.loader as sl
        from supertonic import TTS
        gpu = "CUDAExecutionProvider" in ort.get_available_providers()
        prov = ["CUDAExecutionProvider", "CPUExecutionProvider"] if gpu else ["CPUExecutionProvider"]
        sc.DEFAULT_ONNX_PROVIDERS = sl.DEFAULT_ONNX_PROVIDERS = prov  # 패키지 기본값이 CPU라 불러오기 전에 바꾼다
        _models["tts"] = TTS(auto_download=True)
        _models["tts_device"] = prov[0]
        _models["tts_styles"] = {}
        if gpu:
            # 크기별 세션(tts_bucket.py): 새 문장도 0.04초. 메모리는 필요한 만큼만(kSameAsRequested, 26GB → 약 20GB)
            from tts_bucket import Bucketed
            b = Bucketed(_models["tts"].model, [("CUDAExecutionProvider", {"arena_extend_strategy": "kSameAsRequested"}),
                                                "CPUExecutionProvider"])
            _models["tts_bucket"] = b
            # 모든 크기 세션을 뒤에서 미리 만든다(약 45초). 그동안 들어온 요청도 되지만 그 크기는 처음 한 번 느리다
            threading.Thread(target=lambda: _models.__setitem__("tts_warm", b.warm(tts_style("F1"))), daemon=True).start()
    return _models["tts"]


def tts_style(voice: str):
    styles = _models["tts_styles"]
    if voice not in styles:
        styles[voice] = _models["tts"].get_voice_style(voice_name=voice)
    return styles[voice]


def vlm():
    if "vlm" not in _models:
        import torch
        from transformers import AutoProcessor, Qwen3VLForConditionalGeneration
        # 버전 4: cuDNN 어텐션 커널을 끈다. torch 2.11은 H100/H200에서 sdpa가 cuDNN 커널을 고르는데, 처음 보는 입력 길이마다
        # 약 0.35초 준비 작업을 해서 새 질문(=새 길이)이면 토큰마다 느렸다(실측: 17토큰 6.4초 → flash/math 고정 시 0.4초)
        torch.backends.cuda.enable_cudnn_sdp(False)
        model = Qwen3VLForConditionalGeneration.from_pretrained(VLM_REPO, dtype=torch.bfloat16, device_map=DEVICE,
                                                                attn_implementation="sdpa").eval()
        _models["vlm"] = (model, AutoProcessor.from_pretrained(VLM_REPO))
    return _models["vlm"]


def _messages(system: str, user: str, images: list | None) -> list:
    content = [{"type": "image", "image": im} for im in (images or [])] + [{"type": "text", "text": user}]
    return [{"role": "system", "content": [{"type": "text", "text": system}]}, {"role": "user", "content": content}]


def generate(system: str, user: str, images: list | None = None, max_new: int = 512, repetition_penalty: float = 1.0,
             no_hanzi: bool = False) -> str:
    return on_gpu(_generate, system, user, images, max_new, repetition_penalty, no_hanzi)


_hanzi_ids: list[int] | None = None


def hanzi_token_ids() -> list[int]:
    """한자(CJK 통합 한자)가 들어 있는 토큰 번호들. 처음 한 번만 어휘 전체를 훑어 만든다(수 초).
    Qwen이 한국어 번역 중간에 调·瓣 같은 중국어 글자를 끼워 넣는 것을 생성 단계에서 막는 데 쓴다(버전 7)."""
    global _hanzi_ids
    if _hanzi_ids is None:
        _, proc = vlm()
        tok = proc.tokenizer
        pat = re.compile(r"[一-鿿㐀-䶿぀-ヿ]")  # 한자 + 일본 가나(ミル 같은 것도 막음, 버전 9)
        _hanzi_ids = [i for i in range(len(tok)) if pat.search(tok.decode([i]))]
    return _hanzi_ids


def _generate(system: str, user: str, images: list | None, max_new: int, repetition_penalty: float = 1.0,
              no_hanzi: bool = False) -> str:
    import torch
    model, proc = vlm()
    with torch.inference_mode():
        inputs = proc.apply_chat_template(_messages(system, user, images), tokenize=True, add_generation_prompt=True,
                                          return_dict=True, return_tensors="pt").to(model.device)
        extra = {"repetition_penalty": repetition_penalty} if repetition_penalty != 1.0 else {}
        if no_hanzi:
            extra["suppress_tokens"] = hanzi_token_ids()
        out = model.generate(**inputs, max_new_tokens=max_new, do_sample=False, **extra)
    return proc.batch_decode(out[:, inputs["input_ids"].shape[1]:], skip_special_tokens=True)[0].strip()


def generate_batch(system: str, users: list[str], images_list: list[list], max_new: int = 512) -> list[str]:
    """장면 여러 개를 한 번에 생성한다(왼쪽 패딩). 한 장면씩보다 GPU를 꽉 채워 전체 시간이 줄어든다(가정, 실측 필요)."""
    return on_gpu(_generate_batch, system, users, images_list, max_new)


def _generate_batch(system: str, users: list[str], images_list: list[list], max_new: int) -> list[str]:
    import torch
    model, proc = vlm()
    texts = [proc.apply_chat_template(_messages(system, u, ims), tokenize=False, add_generation_prompt=True)
             for u, ims in zip(users, images_list)]
    flat = [im for ims in images_list for im in ims]
    proc.tokenizer.padding_side = "left"
    with torch.inference_mode():
        inputs = proc(text=texts, images=flat or None, padding=True, return_tensors="pt").to(model.device)
        out = model.generate(**inputs, max_new_tokens=max_new, do_sample=False)
    return [t.strip() for t in proc.batch_decode(out[:, inputs["input_ids"].shape[1]:], skip_special_tokens=True)]


def generate_stream(system: str, user: str, max_new: int = 200):
    """답변을 조각(토큰 몇 개)씩 낸다. 첫 문장이 끝나는 대로 노트북이 음성을 만들어 첫 소리를 앞당긴다.
    생성은 GPU 작업자 스레드에서(새 스레드를 만들지 않음), 이 함수는 조각을 받아 넘기기만 한다."""
    import torch
    from transformers import TextIteratorStreamer
    model, proc = on_gpu(vlm)
    streamer = TextIteratorStreamer(proc.tokenizer, skip_prompt=True, skip_special_tokens=True)

    def run():
        inputs = proc.apply_chat_template(_messages(system, user, None), tokenize=True, add_generation_prompt=True,
                                          return_dict=True, return_tensors="pt").to(model.device)
        with torch.inference_mode():
            model.generate(**inputs, max_new_tokens=max_new, do_sample=False, streamer=streamer)

    fut = _gpu.submit(run)
    yield from streamer
    fut.result()  # 생성 중 예외가 있으면 여기서 드러난다


def json_block(text: str) -> dict:
    """모델 답에서 첫 JSON 객체를 꺼낸다(코드 블록·앞뒤 말이 붙어 와도)."""
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError("JSON 없음")
    return json.loads(m.group(0))


# 개조식 끝맺음 → 완결 문장(노트북 backend/app/pipeline/local_pipeline.py의 finish_sentence와 같아야 함)
ENDINGS = [(re.compile(r"(있|없)음$"), r"\1습니다"), (re.compile(r"됨$"), "됩니다"), (re.compile(r"함$"), "합니다"),
           (re.compile(r"임$"), "입니다"), (re.compile(r"(있|없)다$"), r"\1습니다")]


def finish_sentence(text: str) -> str:
    """"표시됨", "있음" 같은 개조식 끝을 "~됩니다/~있습니다"로 바꾸고 마침표를 붙인다. 이미 완결 문장이면 마침표만 맞춘다."""
    t = text.strip().rstrip(".。 ")
    if not t:
        return ""
    if not re.search(r"(니다|요|세요|까|죠|[.?!])$", t):
        for pat, rep in ENDINGS:
            if pat.search(t):
                t = pat.sub(rep, t)
                break
    return t if t[-1] in "?!" else t + "."


# ---------- API ----------
@app.get("/health")
def health():
    import torch
    return {"ok": True, "version": VERSION, "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
            "loaded": [k for k in _models if not k.endswith(("_device", "_styles", "_bucket", "_warm"))], "vlm": VLM_REPO,
            "whisper": WHISPER_REPO, "ocrDevice": _models.get("ocr_device"), "ttsDevice": _models.get("tts_device"),
            "ttsWarmSessions": _models.get("tts_warm"), "describeBatch": DESCRIBE_BATCH,
            "calls": _stats["calls"]}


@app.post("/warmup")
def warmup():
    """모델을 미리 올려 둔다(첫 요청이 모델 내려받기·로드를 기다리지 않게)."""
    t0 = time.time()
    with _tts_lock:
        tts_engine()  # 크기별 세션 미리 만들기는 뒤에서 이어진다(/health의 ttsWarmSessions가 53이면 끝)
    with _lock:
        whisper(), ocr_engine(), on_gpu(vlm)
        generate("짧게 답하세요.", "안녕", max_new=4)  # 작업자 스레드의 CUDA 준비까지 미리(첫 호출 3초 예열을 여기서)
    return {"ok": True, "sec": round(time.time() - t0, 1)}


class TtsBody(BaseModel):
    text: str  # 노트북에서 숫자·영어를 한국어로 바꾼(ko_normalize) 뒤 보낸다
    voice: str = "F1"
    format: str = "wav"  # "mp3"면 여기서 바로 줄여 보낸다(490KB → 약 40KB, 터널 전송 0.25초 → 0.03초 수준)


@app.post("/tts")
def tts(body: TtsBody):
    """안내 목소리 한 문장 → wav 또는 mp3(헤더 X-Duration-Ms). 캐시는 노트북이 한다. mp3는 libsndfile로(이 서버엔 ffmpeg가 없음)."""
    from fastapi import Response
    import soundfile as sf
    text = body.text.strip()[:500]
    if not text:
        return JSONResponse({"error": "empty"}, status_code=400)
    voice = body.voice if body.voice in TTS_VOICES else "F1"
    t0 = time.time()
    with _tts_lock:  # 문장당 0.04초라 줄이 거의 안 생김
        engine = tts_engine()
        style = tts_style(voice)
        out = _models["tts_bucket"].synth(text, style, TTS_STEPS) if "tts_bucket" in _models else None
        if out is None:  # GPU가 없거나 아주 긴 문장(120자 넘음): 원래 방식(덩어리로 나눠 만듦)
            wav, dur = engine.synthesize(text, voice_style=style, lang="ko", total_steps=TTS_STEPS)
            out = (wav.reshape(-1), float(dur[0]))
    buf = io.BytesIO()
    if body.format == "mp3":
        sf.write(buf, out[0], engine.sample_rate, format="MP3", subtype="MPEG_LAYER_III")
        media = "audio/mpeg"
    else:
        sf.write(buf, out[0], engine.sample_rate, format="WAV", subtype="PCM_16")
        media = "audio/wav"
    _count("tts", t0)
    return Response(buf.getvalue(), media_type=media, headers={"X-Duration-Ms": str(int(out[1] * 1000))})


def wav_16k(data: bytes):
    """16kHz mono 16bit wav → float32 배열(faster-whisper가 바로 받는 형식)."""
    import wave

    import numpy as np
    with wave.open(io.BytesIO(data)) as w:
        if w.getframerate() != 16000 or w.getnchannels() != 1 or w.getsampwidth() != 2:
            raise ValueError("16kHz mono 16bit wav만 받습니다")
        pcm = w.readframes(w.getnframes())
    return np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0


@app.post("/stt")
def stt(audio: UploadFile = File(...), language: str = Form("ko"), prompt: str = Form("")):
    """language: "ko"(기본, 질문 녹음) 또는 "auto"(업로드 영상: 언어 자동 감지). 버전 5부터.
    prompt: 받아쓰기 힌트(영상 제목·인물 이름·목차 단어). 고유명사 인식을 높인다. 버전 13부터(옛 클라이언트는 안 보냄).
    한국어로 고정하면 영어 내레이션 영상을 "1.2.1." 같은 엉터리로 받아쓴다(2026-10-29 망고 커리 시험)."""
    t0 = time.time()
    # 노트북이 16kHz mono 16bit wav로 보내므로 PyAV 없이 직접 읽는다(PyAV 버전 충돌로 받아쓰기가 실패한 적이 있음)
    samples = wav_16k(audio.file.read())
    lang = None if language == "auto" else language
    with _lock:
        segs, info = whisper().transcribe(samples, language=lang, beam_size=5, vad_filter=True, condition_on_previous_text=False,
                                          initial_prompt=prompt.strip()[:400] or None)
        segs = list(segs)
    _count("stt", t0)
    return {"segments": [{"startMs": int(s.start * 1000), "endMs": int(s.end * 1000), "text": s.text.strip()}
                         for s in segs if s.text.strip()], "model": WHISPER_REPO,
            "language": getattr(info, "language", lang), "languageProbability": round(float(getattr(info, "language_probability", 0) or 0), 2)}


@app.post("/ocr")
def ocr(images: list[UploadFile] = File(...)):
    t0 = time.time()
    texts = []
    with _lock:
        eng = ocr_engine()
        for up in images:
            with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
                f.write(up.file.read())
                path = f.name
            try:
                lines = []
                for r in eng.predict(path):
                    for t, s in zip(r["rec_texts"], r["rec_scores"]):
                        if t.strip() and float(s) >= 0.6:
                            lines.append(t.strip())
                texts.append(lines)
            finally:
                Path(path).unlink(missing_ok=True)
    _count("ocr", t0)
    return {"texts": texts, "model": "PaddleOCR korean"}


class DescribeScene(BaseModel):
    startMs: int
    endMs: int
    transcript: str = ""
    ocr: list[str] = []
    frames: list[str] = []  # base64 jpg


class DescribeBody(BaseModel):
    title: str
    guide: str = ""
    scenes: list[DescribeScene]


DESCRIBE_SYSTEM = """당신은 시각장애인을 위한 화면해설 작가입니다. 한 장면의 사진 몇 장과 그 장면의 대사·화면 글자를 받습니다.
화면에 보이는 것만 쓰고 추측하지 않습니다. 대사 내용을 반복하지 않습니다.
문장 규칙(꼭 지키세요)
- 모든 문장은 "~합니다", "~있습니다", "~입니다"처럼 현재형으로 끝나는 완결된 문장입니다. "표시됨", "구성됨", "있음"처럼 명사형으로 끝내지 않습니다.
- 한 문장은 40자 안팎, 한 문장에 한 가지 내용. 장면마다 문장 3~5개.
- 문장 하나만 들어도 뜻이 통하게 씁니다("그", "이어서", "또한"으로 시작하지 않습니다). 같은 내용을 단계별로 다시 쓰지 않습니다.
- 숫자·표·그래프의 값은 화면 글자에 적힌 대로 정확히 읽습니다.
해설 문장(lines)은 누적형입니다: level 1은 꼭 필요한 것(장면 바뀜, 핵심 행동, 중요한 화면 글자), level 2는 행동·표정·장소, level 3은 옷차림·배경·분위기.
사람 이름은 화면 글자나 대사, 또는 주어진 등장인물 사전에 근거가 있을 때만 쓰고, 근거를 basis에 적습니다. 없으면 name은 null.
반드시 JSON 하나로만 답하세요:
{"title": "장면 목차용 한 줄 제목", "people": [{"name": null, "basis": null, "appearance": "겉모습"}],
 "lines": [{"level": 1, "text": "..."}, {"level": 2, "text": "..."}]}"""


def _img(b64: str):
    from PIL import Image
    return Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")


def _scene_prompt(body: DescribeBody, i: int, s: DescribeScene) -> str:
    return (f"영상 제목: {body.title}\n{body.guide}\n장면 {i + 1}/{len(body.scenes)}, 길이 {(s.endMs - s.startMs) / 1000:.0f}초\n"
            f"이 장면의 대사: {s.transcript or '(없음)'}\n화면 글자(OCR, 오류 있을 수 있음): {', '.join(s.ocr) or '(없음)'}")


def _parse_scene(raw: str, i: int, s: DescribeScene) -> dict:
    try:
        j = json_block(raw)
    except (ValueError, json.JSONDecodeError):
        j = {"title": f"{i + 1}번째 장면", "people": [], "lines": [{"level": 1, "text": raw[:60]}]}
    # 시각은 모델에게 묻지 않는다(숫자 시각은 틀리기 쉬움, PoC). 장면 시작부터 읽는 시간만큼 띄워 붙인다
    t, lines = s.startMs + 300, []
    for ln in sorted(j.get("lines", []), key=lambda x: int(x.get("level", 2))):
        text = finish_sentence(str(ln.get("text", "")))
        if not text:
            continue
        lines.append({"atMs": min(t, max(s.startMs, s.endMs - 500)), "level": min(3, max(1, int(ln.get("level", 2)))), "text": text})
        t += READ_MS_PER_CHAR * len(text.replace(" ", "")) + READ_BASE_MS
    return {"title": str(j.get("title") or f"{i + 1}번째 장면")[:100], "people": j.get("people") or [], "lines": lines}


@app.post("/describe")
def describe(body: DescribeBody):
    t0 = time.time()
    raws: list[str | None] = [None] * len(body.scenes)
    if DESCRIBE_BATCH > 1 and len(body.scenes) > 1:
        try:
            for k in range(0, len(body.scenes), DESCRIBE_BATCH):
                idx = list(range(k, min(k + DESCRIBE_BATCH, len(body.scenes))))
                with _lock:
                    outs = generate_batch(DESCRIBE_SYSTEM, [_scene_prompt(body, i, body.scenes[i]) for i in idx],
                                          [[_img(f) for f in body.scenes[i].frames] for i in idx], max_new=600)
                for i, o in zip(idx, outs):
                    raws[i] = o
        except Exception as e:  # noqa: BLE001 — 묶음 생성이 안 되면 하나씩(예전 방식)
            print("batch describe failed, fallback:", type(e).__name__, str(e)[:200], flush=True)
            raws = [None] * len(body.scenes)
    out = []
    for i, s in enumerate(body.scenes):
        if raws[i] is None:
            with _lock:
                raws[i] = generate(DESCRIBE_SYSTEM, _scene_prompt(body, i, s), [_img(f) for f in s.frames], max_new=600)
        out.append(_parse_scene(raws[i], i, s))
    _count("describe", t0)
    return {"scenes": out, "model": VLM_REPO}


class SummarizeBody(BaseModel):
    title: str
    transcript: str = ""
    sceneTitles: list[str] = []
    lines: list[str] = []


CATEGORIES = ["교육", "요리·음식", "게임", "음악", "과학·IT", "뉴스", "예능", "스포츠", "기타"]


@app.post("/summarize")
def summarize(body: SummarizeBody):
    t0 = time.time()
    system = ("영상 정보를 보고 시각장애인이 재생 전에 들을 30초 안쪽 요약(2~3문장, '~합니다'체 완결 문장)과 카테고리를 정하세요. "
              f'카테고리는 {", ".join(CATEGORIES)} 중 하나. JSON 하나로만: {{"summary": "...", "category": "..."}}')
    user = (f"제목: {body.title}\n장면 제목: {' / '.join(body.sceneTitles)}\n해설: {' '.join(body.lines)[:3000]}\n"
            f"대사: {body.transcript[:3000]}")
    with _lock:
        raw = generate(system, user, max_new=300)
    try:
        j = json_block(raw)
    except (ValueError, json.JSONDecodeError):
        j = {"summary": raw[:300], "category": "기타"}
    _count("summarize", t0)
    cat = j.get("category") if j.get("category") in CATEGORIES else "기타"
    return {"summary": str(j.get("summary", "")).strip(), "category": cat, "model": VLM_REPO}


class TranslateBody(BaseModel):
    texts: list[str]
    source: str | None = None  # 받아쓰기가 감지한 언어(en 등). 모르면 None
    title: str | None = None   # 영상 제목(고유명사·주제 맥락). 예: "몰디브 망고 커리 만들기"


TRANSLATE_SYSTEM = ("영상 대사를 한국어로 옮기는 번역가입니다. '번역할 조각'에 번호 붙은 대사 조각을 받습니다. 조각은 말하는 도중에 "
                    "끊겨 있을 수 있으니 '앞뒤 맥락'과 영상 제목을 참고해 자연스러운 한국어 구어체로 옮기되, 조각 수와 순서는 그대로 "
                    "지킵니다(합치거나 나누지 않음). 맥락 줄은 번역하지 않습니다. 지명·인명 같은 고유명사는 원문 그대로의 뜻으로 "
                    "(Maldives → 몰디브). 재료 이름·숫자·단위는 정확히(1 tablespoon → 1큰술, teaspoon → 작은술, cup → 컵). "
                    "말투: 영상 속 사람이 시청자에게 말하는 대사이므로 모든 문장을 '~해요', '~예요', '~세요' 같은 해요체로 통일합니다"
                    "('~합니다', '~이다'로 끝내지 않음. 버전 11). "
                    'JSON 하나로만: {"ko": ["1번 번역", "2번 번역", ...]}')
TRANSLATE_CHUNK = 1     # 21개 한 번에: "네가 네가…" 반복 / 6개씩: 같은 번역이 4번 반복·순서 밀림 → 한 조각씩(앞뒤 맥락 2개)
TRANSLATE_CONTEXT = 2   # 앞뒤 맥락으로 함께 보여 줄 조각 수
REPEAT_PENALTY = 1.1
HANZI = re.compile("[一-鿿]")  # 한자(CJK 통합 한자)


# 다시 시킬 때 붙이는 말. 같은 질문에는 늘 같은 답이 나오므로(탐욕적 생성) 질문을 바꿔 다른 답을 끌어낸다. 버전 7(2026-10-29):
# "five garlic cloves one teaspoon grated ginger"를 매번 "마늘 두瓣, 갈근 한 큰술"로 옮겨 영어로 남던 것
RETRY_HINT = ("\n주의: 한글로만 쓰고 숫자와 분량을 빠뜨리지 마세요. 요리 용어 예: five garlic cloves → 마늘 다섯 쪽, "
              "one teaspoon grated ginger → 간 생강 한 작은술, tablespoon → 큰술, cloves(향신료) → 정향, cinnamon bark → 계피, "
              "curry leaves → 커리 잎, green chilies → 풋고추, dried fish flakes → 말린 생선 가루, turmeric → 강황, "
              "turn down the heat → 불을 줄이다.")


def _translate_part(body: TranslateBody, part: list[str], before: list[str], after: list[str], retry: bool = False) -> list[str] | None:
    ctx = "\n".join([f"(앞) {t}" for t in before] + [f"(뒤) {t}" for t in after]) or "(없음)"
    numbered = "\n".join(f"{i + 1}. {t}" for i, t in enumerate(part))
    user = (f"영상 제목: {body.title or '모름'}\n원래 언어: {body.source or '모름'}\n앞뒤 맥락(번역하지 않음):\n{ctx}\n"
            f"번역할 조각({len(part)}개):\n{numbered}" + (RETRY_HINT if retry else ""))
    with _lock:
        raw = generate(TRANSLATE_SYSTEM, user, max_new=80 * len(part) + 60, repetition_penalty=REPEAT_PENALTY, no_hanzi=True)
    try:
        ko = [re.sub(r"^\s*\d+\s*[.)]\s*", "", str(x)).strip() for x in json_block(raw).get("ko", [])]  # "1. " 같은 번호 떼기
    except (ValueError, json.JSONDecodeError, AttributeError):
        ko = []
    if len(ko) == len(part) and all(ko) and not any(HANZI.search(x) for x in ko):  # 한자가 섞이면(瓣, 调 등) 실패로 보고 다시
        return ko
    print(f"translate part failed: got {len(ko)} of {len(part)}; raw={raw[:200]!r}", flush=True)
    return None


@app.post("/translate")
def translate(body: TranslateBody):
    """외국어 대사를 한국어로(버전 6). 6개씩 앞뒤 맥락과 함께 옮기고, 묶음이 실패하면 한 조각씩 다시, 그래도 안 되면 원문."""
    t0 = time.time()
    out: list[str] = []
    fallback = 0
    texts = body.texts
    for k in range(0, len(texts), TRANSLATE_CHUNK):
        part = texts[k:k + TRANSLATE_CHUNK]
        before, after = texts[max(0, k - TRANSLATE_CONTEXT):k], texts[k + len(part):k + len(part) + TRANSLATE_CONTEXT]
        ko = _translate_part(body, part, before, after)
        if ko is None and len(part) == 1:  # 한 번 더: 질문을 바꿔서(한자 금지·요리 용어 예시)
            ko = _translate_part(body, part, before, after, retry=True)
        if ko is None and len(part) == 1:
            fallback += 1
            ko = part
        if ko is None:  # 한 조각씩
            ko = []
            for i, t in enumerate(part):
                one = _translate_part(body, [t], texts[max(0, k + i - TRANSLATE_CONTEXT):k + i], texts[k + i + 1:k + i + 1 + TRANSLATE_CONTEXT])
                if one is None:
                    fallback += 1
                ko.append(one[0] if one else t)
        out += ko
    _count("translate", t0)
    return {"texts": out, "model": VLM_REPO, "untranslated": fallback}


class AnswerBody(BaseModel):
    question: str
    context: dict


UNANSWERABLE = "그건 해설 자료에 없어요"
ANSWER_SYSTEM = ("당신은 시각장애인이 영상을 보다가 한 질문에 답하는 도우미입니다. '해설 자료'만 근거로 한국어 1~2문장, 짧게 말하듯 답하세요. "
                 f"자료에 없는 내용은 지어내지 말고 '{UNANSWERABLE}'라고만 답하세요(답할 수 있으면 이 말을 덧붙이지 마세요). "
                 "대사를 따옴표로 그대로 옮기지 말고 내용을 풀어서 말하세요. 이름은 자료에 있을 때만. 시각 숫자는 읽지 마세요.")
SENTENCE_END = re.compile(r"[.?!。]\s")


def _answer_prompt(body: AnswerBody) -> str:
    return f"해설 자료:\n{json.dumps(body.context, ensure_ascii=False)}\n\n질문: {body.question}"


@app.post("/chat/answer")
def chat_answer(body: AnswerBody):
    """질문 답변(GMS gemini-3.1-flash-lite 대체). 자료만 근거로 1~2문장. 전체를 한 번에 돌려준다."""
    t0 = time.time()
    with _lock:
        text = generate(ANSWER_SYSTEM, _answer_prompt(body), max_new=200)
    _count("answer", t0)
    sentences = [s.strip() for s in re.findall(r"[^.?!。]+[.?!。]?", text) if s.strip()]
    return {"sentences": sentences or [text], "model": VLM_REPO}


@app.post("/chat/answer/stream")
def chat_answer_stream(body: AnswerBody):
    """같은 답변을 문장 단위로 흘려보낸다(한 줄에 JSON 하나). {"sentence": "..."} ... {"done": true, "model": "..."}"""
    def lines():
        t0 = time.time()
        buf = ""
        with _lock:
            for piece in generate_stream(ANSWER_SYSTEM, _answer_prompt(body), max_new=200):
                buf += piece
                while True:
                    m = SENTENCE_END.search(buf)
                    if not m:
                        break
                    yield json.dumps({"sentence": buf[:m.end()].strip()}, ensure_ascii=False) + "\n"
                    buf = buf[m.end():]
        if buf.strip():
            yield json.dumps({"sentence": buf.strip()}, ensure_ascii=False) + "\n"
        _count("answer", t0)
        yield json.dumps({"done": True, "model": VLM_REPO, "sec": round(time.time() - t0, 2)}) + "\n"

    return StreamingResponse(lines(), media_type="application/x-ndjson")


class IntentBody(BaseModel):
    utterance: str


INTENT_SYSTEM = """시각장애인이 영상을 보다가 한 말을 분류하세요. JSON 하나로만: {"intent": "...", "target_time": null, "scene_query": null}
- QUESTION: 영상 내용 질문. 예) "지금 누가 울고 있어?", "저 사람 뭐 하는 거야"
- SCENE_NOW: 지금 장면 설명 요청. 예) "지금 뭐 나와", "이 장면 설명해 줘"
- SEEK_SCENE: 장면 내용으로 이동. 예) "우사기 나오는 데로", "아까 노래 부르던 데 다시", "그 노래 다시 듣고 싶어" → scene_query에 찾을 내용
- SEEK_TIME: 시각으로 이동. 예) "3분 20초" → target_time "03:20"
- SETTING: 상세도·속도·자막 설정 변경. 예) "좀 더 자세히 말해 줘", "천천히"
- ACTION: 재생·멈춤·지금 위치. 예) "잠깐만", "계속"
- UNKNOWN: 영상과 상관없는 말. 예) "배고프다" """


@app.post("/chat/intent")
def chat_intent(body: IntentBody):
    """발화 분석(규칙으로 못 정한 말만 온다). QUESTION / SCENE_NOW / SEEK_SCENE / SEEK_TIME / SETTING / ACTION / UNKNOWN"""
    t0 = time.time()
    with _lock:
        raw = generate(INTENT_SYSTEM, "말: " + body.utterance, max_new=80)
    try:
        j = json_block(raw)
    except (ValueError, json.JSONDecodeError):
        j = {"intent": "QUESTION"}
    _count("intent", t0)
    return {**j, "model": VLM_REPO}


@app.exception_handler(Exception)
async def errors(_, exc: Exception):
    from fastapi.responses import JSONResponse
    return JSONResponse({"error": type(exc).__name__, "message": str(exc)[:300]}, status_code=500)


if __name__ == "__main__":
    print("uvicorn으로 실행하세요: uvicorn server:app --host 127.0.0.1 --port 8100")
