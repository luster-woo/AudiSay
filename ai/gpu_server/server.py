"""AudiSay 오픈소스 추론 서버(H200 주피터에서 실행). 노트북 데모 서버가 jupyter-server-proxy를 거쳐 부른다.

모델(예전 PoC에서 검증한 조합, AI 테스트/results/report.md)
- 받아쓰기: faster-whisper large-v3-turbo(int8_float16, VAD) — PoC CER 0.46%
- 화면 글자: PaddleOCR korean(PP-OCRv5) — PoC CER 2.9%
- 장면 해설·요약·질문 답변·발화 분석: Qwen3-VL(글만으로도 대화 가능 → 모델 하나만 올림). 기본 8B(가정, 32B도 시험 가능)

실행: uvicorn server:app --host 127.0.0.1 --port 8100   (밖으로 열지 않는다. 노트북은 SSH 터널로, 요청마다 .secret 비밀값 확인)
약속(노트북 backend/app/pipeline/inference.py와 같아야 함):
  /health, /warmup, /stt, /ocr, /describe, /summarize, /chat/answer, /chat/answer/stream, /chat/intent, /tts(버전 12), /generate_json(버전 21), /speakers(버전 22),
  /faces(버전 23)

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
import urllib.request
from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

VERSION = 26
VLM_REPO = os.getenv("VLM_REPO", "Qwen/Qwen3-VL-8B-Instruct")
WHISPER_REPO = os.getenv("WHISPER_REPO", "deepdml/faster-whisper-large-v3-turbo-ct2")
DEVICE = os.getenv("DEVICE", "cuda:0")
DESCRIBE_BATCH = int(os.getenv("DESCRIBE_BATCH", "1"))  # 장면 몇 개를 한 번에 생성하나. 실측(2026-10-28) 4개 묶음이 하나씩보다 3배 느리고
# 문장이 장면 끝에 몰려 기본은 1. 큰 모델·vLLM으로 바꾸면 다시 시험
READ_MS_PER_CHAR, READ_BASE_MS = 182, 900  # 해설 읽는 시간 추정(Gemini TTS 실측), 문장 사이 간격에 쓴다
# 장면 해설 출력 한도. 600이면 인물·문장 많은 장면에서 JSON이 끊겼다(버전 14, Caminandes 7번 장면). 끊겨도 salvage_scene이 건진다
DESCRIBE_MAX_NEW = int(os.getenv("DESCRIBE_MAX_NEW", "1200"))

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


# 버전 15: 장면 해설·요약·번역은 같은 모델을 띄운 vLLM(별도 프로세스, 127.0.0.1:8200)에 보낸다. 끝난 요청을 바로 빼고 새 요청을
# 넣는 연속 배칭이라 동시에 보낼수록 빠르다(2026-11-02 실측: 망고 커리 8장면 HF 하나씩 44.8초 → vLLM 동시에 3.7초).
# 꺼져 있거나 실패하면 None → 예전처럼 HF generate. 버전 19부터 질문 답변·발화 분석도 vLLM(HF 8B는 vLLM이 꺼졌을 때만 올림). 빈 값이면 vLLM을 쓰지 않는다
# 버전 20: 8B vLLM(GPU 24GB)을 끄고 장면 해설·요약·번역·질문 답변·발화 분석도 32B vLLM(8201)에 보낸다(2026-11-04 메모리 정리).
# 8B를 다시 쓰려면 VLLM_URL=http://127.0.0.1:8200/v1 VLLM_MODEL=Qwen/Qwen3-VL-8B-Instruct로 켠다
VLLM_URL = os.getenv("VLLM_URL", "http://127.0.0.1:8201/v1").rstrip("/")
VLLM_PARALLEL = int(os.getenv("VLLM_PARALLEL", "8"))  # 한 요청 안에서 동시에 보내는 장면·번역 조각 수
# 버전 17: 영상 전체 줄거리(/story)만 더 큰 모델에 맡긴다(8B는 사진 대신 소리 목록·예시를 베꼈다, 2026-11-03).
# 비어 있거나 꺼져 있으면 위 8B vLLM → HF 순서로 대체
STORY_VLLM_URL = os.getenv("STORY_VLLM_URL", "http://127.0.0.1:8201/v1").rstrip("/")
# 버전 24(2026-11-12): 8201의 모델을 Qwen3-VL-32B FP8(2025년)에서 Qwen3.8-27B FP8로 바꿨다. 실측(benchmarks/README.md):
# 영상 통째 해설이 30~40% 빠르고 영상 끝까지 쓰며(32B는 마지막 20~40초를 빠뜨림), 줄거리·번역은 약 2배 빠르고 번역 용어가 맞다
STORY_MODEL = os.getenv("STORY_MODEL", "Qwen/Qwen3.8-27B-FP8")
VLLM_MODEL = os.getenv("VLLM_MODEL", STORY_MODEL)  # VLLM_URL에 떠 있는 모델 이름(HF 대체는 VLM_REPO)
# Qwen3.8은 기본으로 답 앞에 생각 과정을 쓴다. 기본은 끔(실측은 끈 상태로 했다). VLLM_THINK=1이면 켠다: 8201을
# --reasoning-parser qwen3로 띄워 생각 과정은 답(content)과 따로 오고, 출력 한도에 생각 토큰도 들어가니 한도를 넉넉히.
# Qwen3-VL은 이 값을 무시한다
NO_THINK = {"chat_template_kwargs": {"enable_thinking": os.getenv("VLLM_THINK", "0") == "1"}}


def _post_json(url: str, body: dict, timeout: float) -> dict:
    req = urllib.request.Request(url, json.dumps(body).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def vllm_generate(system: str, user: str, images_b64: list[str] | None = None, max_new: int = 512,
                  repetition_penalty: float = 1.0, url: str | None = None, model: str | None = None,
                  json_schema: dict | None = None) -> str | None:
    """generate와 같은 일을 vLLM에 맡긴다. 사진은 base64 JPEG 그대로. 쓸 수 없으면 None. 한자 금지는 못 함(_translate_part 참고).
    url·model을 주면 그 vLLM(예: 줄거리용 32B)에 보낸다. json_schema를 주면 그 형식으로만 생성한다(버전 25)."""
    url = url or VLLM_URL
    if not url:
        return None
    content = [{"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + b}} for b in images_b64 or []]
    body = {"model": model or VLLM_MODEL, "temperature": 0, "max_tokens": max_new, **NO_THINK,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": content + [{"type": "text", "text": user}]}]}
    if repetition_penalty != 1.0:
        body["repetition_penalty"] = repetition_penalty
    if json_schema:
        body["response_format"] = {"type": "json_schema", "json_schema": {"name": "Result", "schema": json_schema}}
    try:
        return _post_json(url + "/chat/completions", body, timeout=600)["choices"][0]["message"]["content"].strip()
    except Exception as e:  # noqa: BLE001 — 꺼져 있음·시간 초과 등은 HF로
        print("vllm failed, HF fallback:", type(e).__name__, str(e)[:200], flush=True)
        return None


def llm(system: str, user: str, max_new: int = 512) -> str:
    """글만 주고받는 생성(질문 답변·발화 분석). vLLM이 쓸 수 없을 때만 HF(버전 19: 이때 처음 HF 모델을 올린다)."""
    raw = vllm_generate(system, user, max_new=max_new)
    if raw is None:
        with _lock:
            raw = generate(system, user, max_new=max_new)
    return raw


def vllm_stream(system: str, user: str, max_new: int = 200):
    """vLLM 답을 조각씩(서버가 보내는 SSE 한 줄 = 조각 하나). 연결 전에 실패하면 예외 → 부르는 쪽이 HF로."""
    body = {"model": VLLM_MODEL, "temperature": 0, "max_tokens": max_new, "stream": True, **NO_THINK,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
    req = urllib.request.Request(VLLM_URL + "/chat/completions", json.dumps(body).encode(), {"Content-Type": "application/json"})
    r = urllib.request.urlopen(req, timeout=60)

    def pieces():
        with r:
            for line in r:
                line = line.decode().strip()
                if not line.startswith("data: ") or line == "data: [DONE]":
                    continue
                piece = json.loads(line[6:])["choices"][0]["delta"].get("content")
                if piece:
                    yield piece
    return pieces()


def vllm_ok(url: str | None = None) -> bool:
    try:
        with urllib.request.urlopen((url or VLLM_URL) + "/models", timeout=2) as r:
            return r.status == 200
    except Exception:  # noqa: BLE001
        return False
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
            "vllm": vllm_ok() if VLLM_URL else None,
            "storyModel": STORY_MODEL if STORY_VLLM_URL and vllm_ok(STORY_VLLM_URL) else None,
            "calls": _stats["calls"]}


@app.post("/warmup")
def warmup():
    """모델을 미리 올려 둔다(첫 요청이 모델 내려받기·로드를 기다리지 않게)."""
    t0 = time.time()
    with _tts_lock:
        tts_engine()  # 크기별 세션 미리 만들기는 뒤에서 이어진다(/health의 ttsWarmSessions가 53이면 끝)
    with _lock:
        whisper(), ocr_engine(), on_gpu(sound_model)
        if not vllm_ok():  # 버전 19: 언어 모델은 vLLM이 맡아 HF 8B(약 17GB)는 vLLM이 꺼져 있을 때만 올린다
            on_gpu(vlm)
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
        # 버전 26: 단어 시각을 켜고 구간을 첫 단어~끝 단어로 좁힌다. 영화 배경음악을 VAD가 말소리로 봐서 "Knight to E5"
        # (실제 39.7~41.5초)가 1.0~41.4초로 잡혔고, 0~39초 장면마다 체스 대사가 붙어 해설이 앞당겨졌다(2026-11-12 해리포터)
        segs, info = whisper().transcribe(samples, language=lang, beam_size=5, vad_filter=True, condition_on_previous_text=False,
                                          initial_prompt=prompt.strip()[:400] or None, word_timestamps=True)
        segs = list(segs)
    _count("stt", t0)

    def span(s) -> tuple[float, float]:
        ws = [w for w in (s.words or []) if w.word.strip()]
        return (ws[0].start, ws[-1].end) if ws else (s.start, s.end)

    return {"segments": [{"startMs": int(span(s)[0] * 1000), "endMs": int(span(s)[1] * 1000), "text": s.text.strip()}
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


# ---------- 버전 16: 소리 사건(효과음·음악) ----------
# 받아쓰기(whisper)는 말소리만 글로 바꾸고 기차 경적·긴박한 음악은 버려서, 해설이 "기차에 치일 뻔한" 핵심 장면을 몰랐다
# (2026-11-02 Caminandes 41~56초). AudioSet 527종으로 학습한 AST로 2초 창(1초 간격)마다 소리 종류를 뽑아 구간으로 묶는다.
SOUND_REPO = os.getenv("SOUND_REPO", "MIT/ast-finetuned-audioset-10-10-0.4593")
SOUND_MIN_SCORE = float(os.getenv("SOUND_MIN_SCORE", "0.2"))
# 말소리·침묵처럼 해설에 쓸모없는 것은 뺀다. 음악은 분위기(긴박함·슬픔)가 있는 것만 남긴다
SOUND_SKIP = {"Speech", "Silence", "Music", "Inside, small room", "Narration, monologue", "Conversation",
              "Male speech, man speaking", "Female speech, woman speaking", "Child speech, kid speaking", "Speech synthesizer",
              "Background music", "Soundtrack music", "Video game music", "Theme music", "Pop music", "Musical instrument"}
SOUND_KO = {"Train": "기차", "Train horn": "기차 경적", "Train whistle": "기차 기적", "Steam whistle": "증기 기적",
            "Railroad car, train wagon": "기차 바퀴", "Rail transport": "기차", "Train wheels squealing": "기차 바퀴 끽 소리",
            "Steam": "증기", "Vehicle horn, car horn, honking": "경적", "Car": "자동차", "Engine": "엔진", "Explosion": "폭발",
            "Crash": "부딪히는 소리", "Bang": "쾅", "Smash, crash": "와장창", "Breaking": "깨지는 소리", "Thump, thud": "쿵",
            "Whoosh, swoosh, swish": "휙", "Wind": "바람", "Water": "물", "Splash, splatter": "첨벙", "Footsteps": "발소리",
            "Bird": "새", "Animal": "동물", "Dog": "개", "Cat": "고양이", "Laughter": "웃음소리", "Applause": "박수",
            "Screaming": "비명", "Crying, sobbing": "울음", "Siren": "사이렌", "Alarm": "경보", "Bell": "종",
            "Exciting music": "신나는 음악", "Tender music": "잔잔한 음악", "Sad music": "슬픈 음악", "Happy music": "밝은 음악",
            "Scary music": "무서운 음악", "Angry music": "격한 음악", "Funny music": "우스꽝스러운 음악",
            "Suspense music": "긴장감 있는 음악", "Drum roll": "북소리", "Cheering": "환호", "Gasp": "헉 하는 소리"}


def sound_model():
    if "sound" not in _models:
        from transformers import ASTFeatureExtractor, ASTForAudioClassification
        _models["sound"] = (ASTFeatureExtractor.from_pretrained(SOUND_REPO),
                            ASTForAudioClassification.from_pretrained(SOUND_REPO).to(DEVICE).eval())
    return _models["sound"]


def _sound_events(samples, win_sec: float = 2.0, hop_sec: float = 1.0) -> list[dict]:
    import torch
    fe, model = sound_model()
    sr, labels = 16000, model.config.id2label
    starts = list(range(0, max(1, len(samples) - int(win_sec * sr) + 1), int(hop_sec * sr)))
    hits: list[tuple[int, str, float]] = []
    for k in range(0, len(starts), 32):  # 창 32개씩 한 번에
        chunk = [samples[a:a + int(win_sec * sr)] for a in starts[k:k + 32]]
        with torch.inference_mode():
            x = fe(chunk, sampling_rate=sr, return_tensors="pt").to(DEVICE)
            prob = torch.sigmoid(model(**x).logits).cpu()
        for a, p in zip(starts[k:k + 32], prob):
            for idx in torch.nonzero(p >= SOUND_MIN_SCORE).flatten().tolist():
                name = labels[idx]
                if name not in SOUND_SKIP:
                    hits.append((int(a / sr * 1000), name, float(p[idx])))
    # 같은 소리가 이어지는 창을 한 구간으로(2초 안에 다시 나오면 이어진 것으로 본다)
    events: list[dict] = []
    for at, name, score in sorted(hits, key=lambda h: (h[1], h[0])):
        last = events[-1] if events and events[-1]["label"] == name else None
        if last and at <= last["endMs"] + 1000:
            last["endMs"], last["score"] = at + int(win_sec * 1000), max(last["score"], round(score, 2))
        else:
            events.append({"startMs": at, "endMs": at + int(win_sec * 1000), "label": name, "ko": SOUND_KO.get(name),
                           "score": round(score, 2)})
    return sorted(events, key=lambda e: (e["startMs"], -e["score"]))


@app.post("/sounds")
def sounds(audio: UploadFile = File(...)):
    """16kHz mono wav → [{startMs, endMs, label(AudioSet), ko(한국어 이름 또는 null), score}]. 버전 16부터."""
    t0 = time.time()
    samples = wav_16k(audio.file.read())
    with _lock:
        events = on_gpu(_sound_events, samples)
    _count("sounds", t0)
    return {"events": events, "model": SOUND_REPO}


# ---------- 버전 22: 대사 줄마다 누가 말했는지(목소리로 나누기) ----------
# 받아쓰기는 누가 말했는지 몰라서 32B가 이발소의 다른 손님 대사("정말 마음에 들어요")를 주인공 것으로 보고 해설을 지어냈다
# (2026-11-04 큰머리 컵케이크). 줄마다 WavLM 화자 임베딩을 뽑아 평균 연결 군집으로 "화자1, 화자2…"로 나눈다. 이름 맞추기는 32B가
# 대사 내용·화면으로 한다. 실측: 7분 애니 67줄 2.5초, 이발사·주인공은 맞게 모이고 비슷한 만화 목소리끼리는 섞인다
SPEAKER_REPO = os.getenv("SPEAKER_REPO", "microsoft/wavlm-base-plus-sv")
SPEAKER_SAME = float(os.getenv("SPEAKER_SAME", "0.75"))  # 군집끼리 코사인 유사도 평균이 이보다 크면 같은 사람


def speaker_model():
    if "speaker" not in _models:
        from transformers import AutoFeatureExtractor, WavLMForXVector
        _models["speaker"] = (AutoFeatureExtractor.from_pretrained(SPEAKER_REPO),
                              WavLMForXVector.from_pretrained(SPEAKER_REPO).to(DEVICE).eval())
    return _models["speaker"]


# 버전 23: WeSpeaker ResNet34(VoxCeleb, ONNX). wavlm-base-plus-sv는 짧은 한국어 대사에서 남녀를 한 화자로 묶었다
# (2026-11-05 100일의 거짓말, 같은 사람 기준을 0.86까지 올려도 화자1에 남녀가 섞임). onnxruntime GPU로 돈다(설치 없음)
WESPEAKER = Path(__file__).with_name("models") / "voxceleb_resnet34_LM.onnx"
WESPEAKER_SAME = float(os.getenv("WESPEAKER_SAME", "0.55"))
_wespeaker = None


def _kaldi_fbank(x, sr: int = 16000):
    """torchaudio.compliance.kaldi.fbank 기본값(25ms·10ms, povey 창, 80 멜, 512 FFT)을 torch로. 입력은 -1~1 float."""
    import math
    import torch
    w = torch.as_tensor(x, dtype=torch.float32) * 32768.0
    flen, fshift, nfft = 400, 160, 512
    if len(w) < flen:
        w = torch.nn.functional.pad(w, (0, flen - len(w)))
    frames = w.unfold(0, flen, fshift)
    frames = frames - frames.mean(dim=1, keepdim=True)
    frames = torch.cat([frames[:, :1], frames[:, 1:] - 0.97 * frames[:, :-1]], dim=1)
    win = torch.hann_window(flen, periodic=False).pow(0.85)
    spec = torch.fft.rfft(frames * win, n=nfft).abs().pow(2)
    mel = lambda f: 1127.0 * math.log(1.0 + f / 700.0)  # noqa: E731
    lo, hi = mel(20.0), mel(sr / 2)
    pts = torch.linspace(lo, hi, 82)
    fft_mel = 1127.0 * torch.log1p(torch.arange(nfft // 2 + 1) * (sr / nfft) / 700.0)
    banks = torch.zeros(80, nfft // 2 + 1)
    for m in range(80):
        l, c, r = pts[m], pts[m + 1], pts[m + 2]
        up, down = (fft_mel - l) / (c - l), (r - fft_mel) / (r - c)
        banks[m] = torch.clamp(torch.minimum(up, down), min=0)
    feats = torch.log(torch.clamp(spec @ banks.T, min=1.1920929e-07))
    return (feats - feats.mean(dim=0, keepdim=True)).numpy()


def _embed_wespeaker(clips: list) -> list:
    import numpy as np
    import onnxruntime as ort
    global _wespeaker
    if _wespeaker is None:
        _wespeaker = ort.InferenceSession(str(WESPEAKER), providers=["CUDAExecutionProvider", "CPUExecutionProvider"])
    out = []
    for x in clips:
        e = _wespeaker.run(None, {"feats": _kaldi_fbank(x)[None].astype(np.float32)})[0][0]
        out.append(e / (np.linalg.norm(e) + 1e-9))
    return out


def _speakers(samples, segs: list[dict], same: float = 0.0, model: str = "wavlm") -> list[int]:
    import numpy as np
    import torch
    sr, embs, clips = 16000, [], []
    for s in segs:
        a, b = int(s["startMs"] * sr / 1000), int(s["endMs"] * sr / 1000)
        x = samples[a:b] if b - a >= sr // 2 else samples[max(0, a - sr // 4):b + sr // 4]  # 0.5초보다 짧으면 앞뒤를 조금 더
        if len(x) < sr // 10:
            x = np.zeros(sr // 2, dtype=np.float32)
        clips.append(x)
    if model == "wespeaker":
        embs = _embed_wespeaker(clips)
        same = same or WESPEAKER_SAME
    else:
        fe, wavlm = speaker_model()
        for x in clips:
            inp = fe(x, sampling_rate=sr, return_tensors="pt").to(DEVICE)
            with torch.no_grad():
                embs.append(torch.nn.functional.normalize(wavlm(**inp).embeddings[0], dim=-1).cpu().numpy())
    if not embs:
        return []
    E = np.stack(embs)
    S = E @ E.T
    clusters = [[i] for i in range(len(E))]
    while len(clusters) > 1:
        best, pair = -1.0, None
        for i in range(len(clusters)):
            for j in range(i + 1, len(clusters)):
                v = float(S[np.ix_(clusters[i], clusters[j])].mean())
                if v > best:
                    best, pair = v, (i, j)
        if best < (same or SPEAKER_SAME):
            break
        i, j = pair
        clusters[i] += clusters.pop(j)
    label = [0] * len(E)
    for k, c in enumerate(sorted(clusters, key=len, reverse=True), 1):  # 많이 말한 사람이 화자1
        for i in c:
            label[i] = k
    return label


@app.post("/speakers")
def speakers(audio: UploadFile = File(...), segments: str = Form(...), same: float = Form(0.0), model: str = Form("wavlm")):
    """16kHz mono wav + [{startMs, endMs}] → {"speakers": [1, 2, 1, …]}(줄마다 화자 번호, 많이 말한 순).
    same: 같은 사람으로 묶는 유사도(버전 23, 없으면 SPEAKER_SAME)."""
    t0 = time.time()
    samples = wav_16k(audio.file.read())
    segs = json.loads(segments)
    with _lock:
        labels = on_gpu(_speakers, samples, segs, same, model)
    _count("speakers", t0)
    return {"speakers": labels, "model": "Wespeaker/wespeaker-voxceleb-resnet34-LM" if model == "wespeaker" else SPEAKER_REPO}


# ---------- 버전 16: 영상 전체 줄거리(핵심 사건) 먼저 ----------
# 장면마다 사진 몇 장을 따로 보면 "앞에서 기차가 오고 있었다"는 흐름을 몰라 위험한 순간을 놓친다. 3초 간격 사진을 9장씩
# 격자 한 장(시각 표시)으로 묶어 영상 전체를 한 번에 보여 주고, 핵심 사건 목록과 물건·인물의 이름을 먼저 정한다.


class StoryFrame(BaseModel):
    atMs: int
    jpg: str  # base64


class StoryBody(BaseModel):
    title: str
    frames: list[StoryFrame]
    sounds: str = ""      # "41~45초 기차 경적" 같은 줄들
    transcript: str = ""  # 대사(있으면)
    guide: str = ""


STORY_SYSTEM = """당신은 시각장애인을 위한 화면해설 작가입니다. 영상 전체에서 시간 순서로 뽑은 사진 격자(각 칸 왼쪽 위에 초 표시)와
소리 사건, 대사를 받습니다. 이용자가 줄거리를 이해하는 데 꼭 필요한 핵심 사건을 시간 순서로 고릅니다.
- 위험·충돌·구출·추격·반전·감정의 변화처럼 이야기를 바꾸는 사건을 빠뜨리지 않습니다. 소리(기차 경적, 긴박한 음악, 비명)는 위험의 단서입니다.
- 사진과 소리에 근거가 있는 것만 씁니다. 확실하지 않은 물건·특징은 쓰지 않습니다.
- 영상에 나오는 인물(동물·캐릭터 포함)과 중요한 물건의 이름을 하나씩 정합니다. 해설 전체가 이 이름만 씁니다.
- 사건 문장은 "~합니다"로 끝나는 40자 안팎의 한국어 문장입니다.
반드시 JSON 하나로만 답하세요:
{"events": [{"atSec": <초>, "text": "<그 시각의 핵심 사건 한 문장>"}],
 "names": [{"name": "<이름>", "what": "<생김새·역할>"}]}"""


def _grids(frames: list[StoryFrame], per: int = 9, cell: tuple[int, int] = (384, 216)) -> list[str]:
    """사진 9장씩 3×3 격자 한 장(각 칸 왼쪽 위에 '41s')으로 묶어 base64 JPEG 목록을 만든다(vLLM 한 요청 사진 8장 제한)."""
    from PIL import Image, ImageDraw
    out = []
    for k in range(0, len(frames), per):
        part = frames[k:k + per]
        g = Image.new("RGB", (cell[0] * 3, cell[1] * ((len(part) + 2) // 3)), "black")
        d = ImageDraw.Draw(g)
        for j, f in enumerate(part):
            x, y = cell[0] * (j % 3), cell[1] * (j // 3)
            g.paste(_img(f.jpg).resize(cell), (x, y))
            label = f"{f.atMs // 1000}s"
            d.rectangle((x, y, x + 12 * len(label) + 8, y + 24), fill="black")
            try:
                d.text((x + 4, y + 4), label, fill="yellow", font_size=18)
            except (TypeError, OSError, ImportError):  # 옛 Pillow·FreeType 없음: 기본 글꼴
                d.text((x + 4, y + 4), label, fill="yellow")
        buf = io.BytesIO()
        g.save(buf, "JPEG", quality=85)
        out.append(base64.b64encode(buf.getvalue()).decode())
    return out


@app.post("/story")
def story(body: StoryBody):
    """영상 전체 사진(3초 간격 권장) + 소리 + 대사 → 핵심 사건 목록과 이름. 버전 16부터."""
    t0 = time.time()
    grids = _grids(body.frames)[:8]
    user = (f"영상 제목: {body.title}\n{body.guide}\n사진 격자 {len(grids)}장(칸마다 초 표시)\n"
            f"소리 사건:\n{body.sounds or '(없음)'}\n대사:\n{body.transcript[:3000] or '(없음)'}")
    model = STORY_MODEL
    raw = vllm_generate(STORY_SYSTEM, user, grids, max_new=1500, url=STORY_VLLM_URL, model=STORY_MODEL) if STORY_VLLM_URL else None
    if raw is None:
        model, raw = VLM_REPO, vllm_generate(STORY_SYSTEM, user, grids, max_new=1500)
    if raw is None:
        with _lock:
            raw = generate(STORY_SYSTEM, user, [_img(g) for g in grids], max_new=1500)
    try:
        j = json_block(raw)
    except (ValueError, json.JSONDecodeError):
        j = {"events": [{"atSec": int(a), "text": json.loads(f'"{t}"')}
                        for a, t in re.findall(r'"atSec"\s*:\s*(\d+)\s*,\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"', raw)], "names": []}
    events = [{"atMs": int(float(e.get("atSec", 0)) * 1000), "text": finish_sentence(str(e.get("text", "")))}
              for e in j.get("events", []) if str(e.get("text", "")).strip()]
    names = [{"name": str(n.get("name", "")).strip(), "what": str(n.get("what", "")).strip()}
             for n in j.get("names", []) if str(n.get("name", "")).strip()]
    _count("story", t0)
    return {"events": sorted(events, key=lambda e: e["atMs"]), "names": names, "model": model}


# ---------- 버전 18: 영상 통째로 보기(Gemini와 같은 방식) ----------
# 장면을 잘라 사진 몇 장씩 보면 앞뒤 흐름(위험 → 구출)을 놓친다. 32B vLLM에 영상 파일을 그대로 넣으면 시각이 붙은 프레임을
# 한 번에 보고, Gemini와 같은 프롬프트·JSON 스키마로 해설 전체를 쓴다(2026-11-03 Caminandes: 핵심 사건 4.5 → 5~6/7).
# vLLM은 --allowed-local-media-path 아래 파일만 읽으므로 그 폴더에 잠깐 두었다가 지운다
MEDIA_DIR = Path(os.getenv("MEDIA_DIR", str(Path.home() / "vllm_exp" / "media")))


@app.post("/describe_video")
def describe_video(video: UploadFile = File(...), prompt: str = Form(...), schema: str = Form(...),
                   max_tokens: int = Form(10000)):
    """저해상도 MP4(640px·초당 2장 권장) + 프롬프트 + JSON 스키마 → 그 스키마의 JSON. 32B가 꺼져 있으면 503."""
    t0 = time.time()
    if not (STORY_VLLM_URL and vllm_ok(STORY_VLLM_URL)):
        return JSONResponse({"error": "video model off"}, status_code=503)
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    path = MEDIA_DIR / f"req_{os.getpid()}_{threading.get_ident()}_{int(t0 * 1000)}.mp4"
    path.write_bytes(video.file.read())
    body = {"model": STORY_MODEL, "temperature": 0.2, "max_tokens": max_tokens, **NO_THINK,
            "messages": [{"role": "user", "content": [{"type": "video_url", "video_url": {"url": path.as_uri()}},
                                                      {"type": "text", "text": prompt}]}],
            "response_format": {"type": "json_schema", "json_schema": {"name": "Narration", "schema": json.loads(schema)}}}
    # 같은 문장을 되풀이하다 출력 한도에 걸려 JSON이 끊기면(2026-11-03 이바나 영상) 반복 벌점을 주고 한 번 더
    result, usage = None, None
    try:
        for penalty in (1.0, REPEAT_PENALTY):
            if penalty != 1.0:
                body["repetition_penalty"] = penalty
            d = _post_json(STORY_VLLM_URL + "/chat/completions", body, timeout=1200)
            usage = d.get("usage")
            try:
                result = json.loads(d["choices"][0]["message"]["content"])
                break
            except json.JSONDecodeError:
                print("describe_video: broken JSON", d["choices"][0].get("finish_reason"), usage, flush=True)
    finally:
        path.unlink(missing_ok=True)
    _count("describe_video", t0)
    if result is None:
        return JSONResponse({"error": "broken JSON from video model"}, status_code=502)
    return {"result": result, "model": STORY_MODEL, "usage": usage}


# ---------- 버전 21: 글만으로 JSON 하나(32B) ----------
# 올린 영상 장면 목차를 조각마다 고르면 조각 경계에서 끊기고 작은 일이 목차가 됐다(2026-11-04 큰머리 컵케이크).
# 해설이 다 끝난 뒤 영상 전체의 상세도 1 문장·대사를 글로만 보내 메인 장면을 고른다(영상 없이 몇 초)
class JsonBody(BaseModel):
    prompt: str
    json_schema: dict
    max_tokens: int = 2000
    images: list[str] = []  # 버전 23: base64 jpg(얼굴 사진 모음 등), 글 앞에 붙인다


@app.post("/generate_json")
def generate_json(b: JsonBody):
    t0 = time.time()
    if not (STORY_VLLM_URL and vllm_ok(STORY_VLLM_URL)):
        return JSONResponse({"error": "story model off"}, status_code=503)
    content = [{"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{x}"}} for x in b.images[:8]]
    body = {"model": STORY_MODEL, "temperature": 0.2, "max_tokens": b.max_tokens, **NO_THINK,
            "messages": [{"role": "user", "content": content + [{"type": "text", "text": b.prompt}] if content else b.prompt}],
            "response_format": {"type": "json_schema", "json_schema": {"name": "Result", "schema": b.json_schema}}}
    # 깨진 JSON(출력 한도에 걸려 끊김·같은 말 되풀이)이면 반복 벌점을 주고 한 번 더(describe_video와 같게, 버전 23).
    # 끊긴 까닭(finish_reason)과 끝부분을 로그와 응답에 남긴다(2026-11-05 상황 파악이 이유 없이 502)
    last = None
    for penalty in (1.0, REPEAT_PENALTY):
        if penalty != 1.0:
            body["repetition_penalty"] = penalty
        d = _post_json(STORY_VLLM_URL + "/chat/completions", body, timeout=600)
        content = d["choices"][0]["message"]["content"]
        try:
            _count("generate_json", t0)
            return {"result": json.loads(content), "model": STORY_MODEL, "usage": d.get("usage")}
        except json.JSONDecodeError:
            last = {"finish_reason": d["choices"][0].get("finish_reason"), "usage": d.get("usage"), "tail": content[-300:]}
            print("generate_json: broken JSON", last["finish_reason"], last["usage"], flush=True)
    _count("generate_json", t0)
    return JSONResponse({"error": "broken JSON", **last}, status_code=502)


# ---------- 버전 23: 얼굴로 같은 사람 묶기 ----------
# 32B가 조각마다 겉모습으로 인물을 짐작해 히데오(남자)를 단발머리 여성(금서희)에게 붙였다(2026-11-05 100일의 거짓말).
# 얼굴을 찾아(YuNet) 특징(SFace)으로 영상 전체에서 같은 사람끼리 묶어 P1, P2…를 준다. OpenCV 모델이라 CPU로 돌고 GPU를 안 쓴다
# (10분 영상 960px 초당 2장 약 35초). 모델: ~/gpu_server/models (opencv_zoo)
FACE_MODELS = Path(__file__).with_name("models")
FACE_SAME = 0.40      # 얼굴 하나를 무리에 넣는 코사인 유사도(SFace 안내 0.363)
FACE_MERGE = 0.55     # 무리 중심끼리 이만큼 비슷하면 한 사람(같은 여성이 0.72로 두 무리가 됐다)
FACE_MIN_PX = 36      # 이보다 작은 얼굴은 버린다
FACE_MIN_SEC = 3      # 서로 다른 초에 3번 넘게 나와야 사람으로 친다


def _faces(path: str) -> dict:
    import cv2
    import numpy as np
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 2.0
    rec = cv2.FaceRecognizerSF.create(str(FACE_MODELS / "face_recognition_sface_2021dec.onnx"), "")
    det, found_all, k, width = None, [], 0, 0
    while True:
        ok, img = cap.read()
        if not ok:
            break
        if det is None:
            width = img.shape[1]
            det = cv2.FaceDetectorYN.create(str(FACE_MODELS / "face_detection_yunet_2023mar.onnx"), "", (img.shape[1], img.shape[0]), 0.8)
        _, found = det.detect(img)
        for f in found if found is not None else []:
            if min(f[2], f[3]) < FACE_MIN_PX:
                continue
            crop = rec.alignCrop(img, f)
            feat = rec.feature(crop).flatten()
            found_all.append({"t": round(k / fps, 2), "box": [int(v) for v in f[:4]], "feat": feat / np.linalg.norm(feat),
                              "size": int(f[2] * f[3]), "crop": crop})
        k += 1
    groups = []
    for f in sorted(found_all, key=lambda f: -f["size"]):  # 큰(또렷한) 얼굴부터 무리를 만든다
        best, sim = None, FACE_SAME
        for g in groups:
            s = float(g["center"] @ f["feat"])
            if s > sim:
                best, sim = g, s
        if best is None:
            groups.append({"members": [f], "center": f["feat"].copy()})
        else:
            best["members"].append(f)
            c = np.mean([m["feat"] for m in best["members"]], axis=0)
            best["center"] = c / np.linalg.norm(c)
    merged = True
    while merged:  # 중심이 가까운 무리를 합친다
        merged = False
        for a in range(len(groups)):
            for b in range(a + 1, len(groups)):
                if float(groups[a]["center"] @ groups[b]["center"]) >= FACE_MERGE:
                    groups[a]["members"] += groups.pop(b)["members"]
                    c = np.mean([m["feat"] for m in groups[a]["members"]], axis=0)
                    groups[a]["center"] = c / np.linalg.norm(c)
                    merged = True
                    break
            if merged:
                break
    groups = [g for g in groups if len({int(m["t"]) for m in g["members"]}) >= FACE_MIN_SEC]
    groups.sort(key=lambda g: -len(g["members"]))
    persons, frames = [], {}
    for i, g in enumerate(groups, 1):
        pid = f"P{i}"
        ts = sorted({m["t"] for m in g["members"]})
        big = max(g["members"], key=lambda m: m["size"])
        ok, jpg = cv2.imencode(".jpg", big["crop"], [cv2.IMWRITE_JPEG_QUALITY, 85])
        persons.append({"id": pid, "count": len(ts), "first": ts[0], "last": ts[-1],
                        "crop": base64.b64encode(jpg.tobytes()).decode()})
        for m in g["members"]:
            frames.setdefault(m["t"], []).append({"id": pid, "box": m["box"]})
    return {"persons": persons, "frames": [{"t": t, "faces": v} for t, v in sorted(frames.items())],
            "width": width, "faces": len(found_all)}


@app.post("/faces")
def faces(video: UploadFile = File(...)):
    """저해상도 MP4(960px·초당 2장 권장) → 사람(P1…, 화면에 많이 나온 순)과 장마다 얼굴 위치."""
    t0 = time.time()
    with tempfile.NamedTemporaryFile(suffix=".mp4") as tmp:
        tmp.write(video.file.read())
        tmp.flush()
        r = _faces(tmp.name)
    _count("faces", t0)
    return {**r, "model": "OpenCV YuNet 2023mar + SFace 2021dec · CPU"}


class DescribeScene(BaseModel):
    startMs: int
    endMs: int
    transcript: str = ""
    ocr: list[str] = []
    frames: list[str] = []  # base64 jpg
    sounds: str = ""  # 버전 16: 이 장면의 소리 사건("41~45초 기차 경적")
    events: str = ""  # 버전 16: 이 장면 구간의 핵심 사건(/story)


class DescribeBody(BaseModel):
    title: str
    guide: str = ""
    scenes: list[DescribeScene]
    storyline: str = ""  # 버전 16: 영상 전체 핵심 사건(시각 순서)
    names: str = ""      # 버전 16: 정해 둔 인물·물건 이름
    large: bool = False  # 버전 17: 장면 해설도 줄거리용 큰 모델(32B)로. 꺼져 있으면 8B


DESCRIBE_SYSTEM = """당신은 시각장애인을 위한 화면해설 작가입니다. 한 장면의 사진 몇 장과 그 장면의 대사·화면 글자·소리, 영상 전체의 핵심 사건을 받습니다.
화면에 보이는 것만 쓰고 추측하지 않습니다. 대사 내용을 반복하지 않습니다.
문장 규칙(꼭 지키세요)
- 모든 문장은 "~합니다", "~있습니다", "~입니다"처럼 현재형으로 끝나는 완결된 문장입니다. "표시됨", "구성됨", "있음"처럼 명사형으로 끝내지 않습니다.
- 한 문장은 40자 안팎, 한 문장에 한 가지 내용. 장면마다 문장 3~5개.
- 문장 하나만 들어도 뜻이 통하게 씁니다("그", "이어서", "또한"으로 시작하지 않습니다). 같은 내용을 단계별로 다시 쓰지 않습니다.
- 숫자·표·그래프의 값은 화면 글자에 적힌 대로 정확히 읽습니다.
해설 문장(lines)은 누적형입니다: level 1은 이 장면의 핵심 사건(주어진 핵심 사건이 있으면 반드시 담음, 위험·충돌·구출을 먼저), level 2는 행동·표정·장소, level 3은 배경·분위기.
지어내지 않기(버전 16): 안경·장신구·작은 무늬·정확한 색처럼 작은 특징은 여러 사진에서 분명할 때만 씁니다. 만화·애니메이션의 큰 눈이나 눈 테두리는 안경이 아닙니다.
인물·물건은 주어진 이름만 씁니다(같은 물건을 구슬·포도·딸기로 바꿔 부르지 않습니다). 핵심 사건·소리와 어긋나는 내용은 쓰지 않습니다.
사람 이름은 화면 글자나 대사, 또는 주어진 등장인물 사전에 근거가 있을 때만 쓰고, 근거를 basis에 적습니다. 없으면 name은 null.
반드시 JSON 하나로만 답하세요:
{"title": "장면 목차용 한 줄 제목", "people": [{"name": null, "basis": null, "appearance": "겉모습"}],
 "lines": [{"level": 1, "text": "..."}, {"level": 2, "text": "..."}]}"""


def _img(b64: str):
    from PIL import Image
    return Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")


def _scene_prompt(body: DescribeBody, i: int, s: DescribeScene) -> str:
    extra = ""
    if body.storyline:
        extra += f"\n영상 전체 핵심 사건(참고):\n{body.storyline}"
    if body.names:
        extra += f"\n정해 둔 인물·물건 이름: {body.names}"
    if s.events:
        extra += f"\n이 장면 구간의 핵심 사건(level 1에 꼭 담기): {s.events}"
    return (f"영상 제목: {body.title}\n{body.guide}{extra}\n장면 {i + 1}/{len(body.scenes)}, "
            f"{s.startMs // 1000}~{s.endMs // 1000}초, 길이 {(s.endMs - s.startMs) / 1000:.0f}초\n"
            f"이 장면의 대사: {s.transcript or '(없음)'}\n이 장면의 소리: {s.sounds or '(없음)'}\n"
            f"화면 글자(OCR, 오류 있을 수 있음): {', '.join(s.ocr) or '(없음)'}")


_TITLE_RE = re.compile(r'"title"\s*:\s*"((?:[^"\\]|\\.)*)"')
_LINE_RE = re.compile(r'\{\s*"level"\s*:\s*(\d)\s*,\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}')


def salvage_scene(raw: str) -> dict:
    """출력 한도에 걸려 JSON이 중간에 끊긴 답에서 다 쓴 제목·문장만 건진다. 버전 14: 예전에는 답 원문 앞 60자를
    해설 문장으로 넣어 '{"title": ...'을 음성으로 읽었다(2026-11-02 Caminandes 93초)."""
    t = _TITLE_RE.search(raw)
    lines = [{"level": int(lv), "text": json.loads(f'"{tx}"')} for lv, tx in _LINE_RE.findall(raw)]
    return {"title": json.loads(f'"{t.group(1)}"') if t else None, "people": [], "lines": lines}


def _parse_scene(raw: str, i: int, s: DescribeScene) -> dict:
    try:
        j = json_block(raw)
    except (ValueError, json.JSONDecodeError):
        j = salvage_scene(raw)
        print(f"describe scene {i + 1}: JSON 끊김, 문장 {len(j['lines'])}개 건짐", flush=True)
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
    model = VLM_REPO
    if body.large and STORY_VLLM_URL and vllm_ok(STORY_VLLM_URL):
        model = STORY_MODEL
        with ThreadPoolExecutor(VLLM_PARALLEL) as ex:
            raws = list(ex.map(lambda i: vllm_generate(DESCRIBE_SYSTEM, _scene_prompt(body, i, body.scenes[i]), body.scenes[i].frames,
                                                       max_new=DESCRIBE_MAX_NEW, url=STORY_VLLM_URL, model=STORY_MODEL),
                               range(len(body.scenes))))
        if any(r is None for r in raws):  # 큰 모델이 못 쓴 장면은 8B로(아래)
            model = VLM_REPO + "+" + STORY_MODEL
    if VLLM_URL and any(r is None for r in raws):  # 장면을 모두 동시에. 실패한 장면만 아래에서 HF로 하나씩
        todo = [i for i, r in enumerate(raws) if r is None]
        with ThreadPoolExecutor(VLLM_PARALLEL) as ex:
            for i, r in zip(todo, ex.map(lambda i: vllm_generate(DESCRIBE_SYSTEM, _scene_prompt(body, i, body.scenes[i]),
                                                                 body.scenes[i].frames, max_new=DESCRIBE_MAX_NEW), todo)):
                raws[i] = r
        # 실제로 쓴 모델 이름을 돌려준다. 버전 20부터 VLLM_URL에는 32B가 떠 있는데 VLM_REPO(8B)라고 적어
        # 재생 화면 모델 목록에 8B로 보였다(2026-11-05 watch/159). HF로 넘어간 장면이 있으면 아래에서 둘 다 적는다
        if all(r is not None for r in raws):
            model = VLLM_MODEL if model == VLM_REPO else model
    if DESCRIBE_BATCH > 1 and len(body.scenes) > 1 and all(r is None for r in raws):
        try:
            for k in range(0, len(body.scenes), DESCRIBE_BATCH):
                idx = list(range(k, min(k + DESCRIBE_BATCH, len(body.scenes))))
                with _lock:
                    outs = generate_batch(DESCRIBE_SYSTEM, [_scene_prompt(body, i, body.scenes[i]) for i in idx],
                                          [[_img(f) for f in body.scenes[i].frames] for i in idx], max_new=DESCRIBE_MAX_NEW)
                for i, o in zip(idx, outs):
                    raws[i] = o
        except Exception as e:  # noqa: BLE001 — 묶음 생성이 안 되면 하나씩(예전 방식)
            print("batch describe failed, fallback:", type(e).__name__, str(e)[:200], flush=True)
            raws = [None] * len(body.scenes)
    out = []
    for i, s in enumerate(body.scenes):
        if raws[i] is None:
            with _lock:
                raws[i] = generate(DESCRIBE_SYSTEM, _scene_prompt(body, i, s), [_img(f) for f in s.frames], max_new=DESCRIBE_MAX_NEW)
        out.append(_parse_scene(raws[i], i, s))
    _count("describe", t0)
    return {"scenes": out, "model": model}


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
    raw = vllm_generate(system, user, max_new=300)
    if raw is None:
        with _lock:
            raw = generate(system, user, max_new=300)
    try:
        j = json_block(raw)
    except (ValueError, json.JSONDecodeError):
        j = {"summary": raw[:300], "category": "기타"}
    _count("summarize", t0)
    cat = j.get("category") if j.get("category") in CATEGORIES else "기타"
    return {"summary": str(j.get("summary", "")).strip(), "category": cat, "model": VLLM_MODEL}


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
# 한자 + 일본 가나(hanzi_token_ids와 같은 범위). 버전 15: vLLM은 생성 단계에서 못 막아 "코코넛ミル크"가 나왔다 → 결과에서 걸러 HF로 다시
HANZI = re.compile("[一-鿿㐀-䶿぀-ヿ]")


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
    max_new = 80 * len(part) + 60
    # vLLM은 생성 단계 한자 금지를 못 한다(logit_bias가 1024개까지인데 한자 토큰은 2만 7천 개, 넘기면 엔진이 죽음).
    # 먼저 vLLM으로 옮기고, 한자가 섞이는 등 실패한 조각만 HF로 한자를 막고 다시 옮긴다(버전 15).
    # 버전 19: HF 8B를 늘 올려 두지 않으려고, vLLM이 답했는데 틀린 조각은 HF 대신 translate의 한 조각씩·RETRY_HINT 재시도로
    # 버전 25: Qwen3.8이 짧은 대사에서 {"ko": ["잘 써요."}]처럼 괄호를 거꾸로 닫아 다시 해도 같은 답 → 원문(영어)으로 남았다
    # (2026-11-12 해리포터). JSON 형식과 조각 수를 생성 단계에서 강제한다
    schema = {"type": "object", "required": ["ko"], "properties": {"ko": {
        "type": "array", "minItems": len(part), "maxItems": len(part), "items": {"type": "string", "minLength": 1}}}}
    raw = vllm_generate(TRANSLATE_SYSTEM, user, max_new=max_new, repetition_penalty=REPEAT_PENALTY, json_schema=schema)
    ko = _translated(raw, part) if raw is not None else None
    if raw is None:
        with _lock:
            raw = generate(TRANSLATE_SYSTEM, user, max_new=max_new, repetition_penalty=REPEAT_PENALTY, no_hanzi=True)
        ko = _translated(raw, part)
    if ko is None:
        print(f"translate part failed: {len(part)} part(s); raw={raw[:200]!r}", flush=True)
    return ko


def _ko_strings(raw: str) -> list[str] | None:
    """"ko" 목록의 글들. JSON이 깨졌으면(괄호 순서가 틀리는 등) "ko": [ 뒤의 따옴표 안 글만 건진다(버전 25)."""
    try:
        return [str(x) for x in json_block(raw).get("ko", [])]
    except (ValueError, json.JSONDecodeError, AttributeError):
        m = re.search(r'"ko"\s*:\s*\[(.*)', raw, re.S)
        if not m:
            return None
        try:
            return [json.loads(f'"{s}"') for s in re.findall(r'"((?:[^"\\]|\\.)*)"', m.group(1))]
        except json.JSONDecodeError:
            return None


def _translated(raw: str, part: list[str]) -> list[str] | None:
    strings = _ko_strings(raw)
    if strings is None:
        return None
    ko = [re.sub(r"^\s*\d+\s*[.)]\s*", "", x).strip() for x in strings]  # "1. " 같은 번호 떼기
    if len(ko) == len(part) and all(ko) and not any(HANZI.search(x) for x in ko):  # 한자가 섞이면(瓣, 调 등) 실패로 보고 다시
        return ko
    return None


@app.post("/translate")
def translate(body: TranslateBody):
    """외국어 대사를 한국어로(버전 6). 6개씩 앞뒤 맥락과 함께 옮기고, 묶음이 실패하면 한 조각씩 다시, 그래도 안 되면 원문."""
    t0 = time.time()
    texts = body.texts

    def one_part(k: int) -> tuple[list[str], int]:
        part = texts[k:k + TRANSLATE_CHUNK]
        before, after = texts[max(0, k - TRANSLATE_CONTEXT):k], texts[k + len(part):k + len(part) + TRANSLATE_CONTEXT]
        ko = _translate_part(body, part, before, after)
        if ko is None and len(part) == 1:  # 한 번 더: 질문을 바꿔서(한자 금지·요리 용어 예시)
            ko = _translate_part(body, part, before, after, retry=True)
        if ko is None and len(part) == 1:
            return part, 1
        if ko is None:  # 한 조각씩
            ko, failed = [], 0
            for i, t in enumerate(part):
                one = _translate_part(body, [t], texts[max(0, k + i - TRANSLATE_CONTEXT):k + i], texts[k + i + 1:k + i + 1 + TRANSLATE_CONTEXT])
                failed += one is None
                ko.append(one[0] if one else t)
            return ko, failed
        return ko, 0

    # 조각마다 맥락은 원문이라 서로 기다릴 일이 없다. vLLM이면 동시에(버전 15), HF면 예전처럼 차례로
    starts = range(0, len(texts), TRANSLATE_CHUNK)
    if VLLM_URL:
        with ThreadPoolExecutor(VLLM_PARALLEL) as ex:
            parts = list(ex.map(one_part, starts))
    else:
        parts = [one_part(k) for k in starts]
    _count("translate", t0)
    return {"texts": [t for ko, _ in parts for t in ko], "model": VLLM_MODEL, "untranslated": sum(n for _, n in parts)}


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
    text = llm(ANSWER_SYSTEM, _answer_prompt(body), max_new=200)
    _count("answer", t0)
    sentences = [s.strip() for s in re.findall(r"[^.?!。]+[.?!。]?", text) if s.strip()]
    return {"sentences": sentences or [text], "model": VLLM_MODEL}


@app.post("/chat/answer/stream")
def chat_answer_stream(body: AnswerBody):
    """같은 답변을 문장 단위로 흘려보낸다(한 줄에 JSON 하나). {"sentence": "..."} ... {"done": true, "model": "..."}"""
    def lines():
        t0 = time.time()
        buf = ""
        try:
            stream, lock = vllm_stream(ANSWER_SYSTEM, _answer_prompt(body), max_new=200), None
        except Exception as e:  # noqa: BLE001 — vLLM이 꺼져 있으면 HF로(버전 19)
            print("vllm stream failed, HF fallback:", type(e).__name__, str(e)[:200], flush=True)
            lock = _lock
            lock.acquire()
            stream = generate_stream(ANSWER_SYSTEM, _answer_prompt(body), max_new=200)
        try:
            for piece in stream:
                buf += piece
                while True:
                    m = SENTENCE_END.search(buf)
                    if not m:
                        break
                    yield json.dumps({"sentence": buf[:m.end()].strip()}, ensure_ascii=False) + "\n"
                    buf = buf[m.end():]
        finally:
            if lock:
                lock.release()
        if buf.strip():
            yield json.dumps({"sentence": buf.strip()}, ensure_ascii=False) + "\n"
        _count("answer", t0)
        yield json.dumps({"done": True, "model": VLLM_MODEL, "sec": round(time.time() - t0, 2)}) + "\n"

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
    raw = llm(INTENT_SYSTEM, "말: " + body.utterance, max_new=80)
    try:
        j = json_block(raw)
    except (ValueError, json.JSONDecodeError):
        j = {"intent": "QUESTION"}
    _count("intent", t0)
    return {**j, "model": VLLM_MODEL}


@app.exception_handler(Exception)
async def errors(_, exc: Exception):
    from fastapi.responses import JSONResponse
    return JSONResponse({"error": type(exc).__name__, "message": str(exc)[:300]}, status_code=500)


if __name__ == "__main__":
    print("uvicorn으로 실행하세요: uvicorn server:app --host 127.0.0.1 --port 8100")
