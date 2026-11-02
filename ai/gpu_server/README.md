# AudiSay H200 오픈소스 추론 서버

> **팀 서버에서 쓸 때(2026-10-29 이식)**: 데모에서는 노트북이 이 서버를 불렀다. 팀에서는 **AI 워커(`ai/app/inference.py`)**가 부른다.
> 서버 자체(설치·실행·버전 기록)는 아래 데모 내용 그대로다. 바뀌는 것은 연결하는 쪽뿐이다.
>
> | 데모(노트북) | 팀(EC2의 ai 컨테이너) |
> |---|---|
> | 노트북에서 `ssh -N h200`(LocalForward 127.0.0.1:8100) | EC2 호스트에서 같은 터널을 켜 둔다(`autossh` 또는 systemd). 컨테이너가 닿도록 docker 브리지 주소에 연다: `LocalForward 172.17.0.1:8100 127.0.0.1:8100`(0.0.0.0으로 열지 않는다). `docker-compose.prod.yml`의 ai에 `extra_hosts: ["host.docker.internal:host-gateway"]` |
> | 노트북 `demo/.env` | 루트 `.env`: `INFERENCE_MODE=remote`, `H200_BASE_URL=http://host.docker.internal:8100`, `H200_TOKEN=<~/gpu_server/.secret 값>` |
> | `scripts/check_h200.py` | `curl -H "Authorization: token $H200_TOKEN" $H200_BASE_URL/health` (ai 컨테이너 안에서) |
>
> 아래 본문의 `demo/…`, `노트북`, `scripts/h200_*.py`는 데모 레포 기준 기록이다(팀 레포에는 그 스크립트가 없다).

노트북 데모 서버(8801)가 업로드 영상 분석(받아쓰기·화면 글자·장면 해설·요약)과 질문 답변을 이 서버에 맡긴다.
H200(jupyter09)은 밖에서 들어오는 길이 주피터 웹뿐이라, 주피터 공식 확장 **jupyter-server-proxy**로 연결한다.
서버는 `127.0.0.1`에만 열고, 접근은 주피터 로그인 토큰으로만 된다(새 포트를 밖으로 열지 않음).

| 기능 | 모델 | 예전 PoC 결과 |
|---|---|---|
| 받아쓰기 | faster-whisper large-v3-turbo (int8_float16, VAD) | CER 0.46%, 실시간의 31배 |
| 화면 글자 | PaddleOCR korean | CER 2.9% |
| 장면 해설·요약·질문 답변·발화 분석 | Qwen3-VL-8B-Instruct(기본, `VLM_REPO`로 바꿈) | 4B로 60초 숏츠 약 50초. 8B·32B는 시험 전 |

## 0. 파일 옮기기

주피터 파일 탐색기에서 `gpu_server` 폴더를 만들고 `server.py`, `requirements.txt`를 끌어다 올린다.

## 1. jupyter-server-proxy 설치(사용자 계정에만)

주피터 터미널에서:

```bash
pip install --user jupyter-server-proxy
```

그다음 주피터 메뉴 **File → Hub Control Panel → Stop My Server → Start My Server**로 서버를 다시 켠다(확장을 불러오려면 필요).
확인:

```bash
jupyter server extension list 2>&1 | grep -i proxy
```

`jupyter_server_proxy enabled`가 보이면 된다.

## 2. 가상환경과 PyTorch(CUDA 12.8)

```bash
cd ~/gpu_server
uv venv --python 3.12 .venv
source .venv/bin/activate
uv pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128   # torchvision: Qwen3-VL 이미지 처리에 필요
```

## 3. 나머지 설치

```bash
uv pip install -r requirements.txt
uv pip install paddlepaddle-gpu -i https://www.paddlepaddle.org.cn/packages/stable/cu126/   # PaddlePaddle 공식 CUDA 12.6 저장소(12.8 드라이버에서 동작, 가정)
```

> PaddlePaddle GPU를 설치하면 NCCL이 옛 버전(2.25)으로 바뀌어 PyTorch가 `undefined symbol: ncclCommShrink`로 실패할 수 있다. 그때는 PyTorch가 원하는 버전으로 맞춘다:
> `uv pip install "nvidia-nccl-cu12==2.28.9"` (torch 2.11 기준. 다른 버전이면 `python -c "import importlib.metadata as m; print(m.requires('torch'))"`로 확인)

PaddlePaddle GPU 설치가 안 되면 CPU판으로 대신한다(글자 읽기만 조금 느려짐, 서버가 알아서 CPU로 돎):

```bash
uv pip install paddlepaddle
```

## 4. 서버 켜기

```bash
cd ~/gpu_server && source .venv/bin/activate
nohup uvicorn server:app --host 127.0.0.1 --port 8100 > server.log 2>&1 &
curl -s http://127.0.0.1:8100/health
curl -s -X POST http://127.0.0.1:8100/warmup   # 모델 내려받기·로드(처음 한 번, 몇 분 걸림)
```

- 큰 모델 시험: `VLM_REPO=Qwen/Qwen3-VL-32B-Instruct nohup uvicorn ...`
- 끄기: `pkill -f "uvicorn server:app"`
- 주피터 서버가 꺼지면(오래 안 쓰면 자동 종료될 수 있음) 이 서버도 꺼진다. 시연 전에 다시 켠다.

## 5. 노트북에서 연결

1. **주피터 토큰 만들기**: Hub Control Panel → **Token** → "Request new API token". 화면에 나온 토큰을 복사한다(다시 볼 수 없음).
2. 노트북 `C:\Users\SSAFY\Desktop\demo\.env`에 직접 넣는다(채팅에 붙이지 말 것):

```
H200_BASE_URL=https://<주피터 주소>/user/k15d101/proxy/8100
H200_TOKEN=<복사한 토큰>
INFERENCE_MODE=remote
```

`<주피터 주소>`는 브라우저 주소창의 `https://...` 부분(`/user/k15d101/` 앞까지).

3. 데모 서버를 다시 켠다. 연결 확인:

```bash
cd backend && uv run python scripts/check_h200.py
```

### 5-1. SSH 터널로 연결(권장, 2026-10-29)

주피터 주소는 `http://`(평문)라서 토큰과 영상·음성·질문이 그대로 오간다. 서버에 SSH(22번)가 열려 있으니 터널로 암호화한다.

1. 노트북에서 전용 키를 만든다: `ssh-keygen -t ed25519 -N "" -C k15d101-laptop-h200 -f ~/.ssh/h200_id_ed25519`
2. **주피터 웹 터미널**에서 공개키(`~/.ssh/h200_id_ed25519.pub` 내용)를 등록한다:
   `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '<공개키 한 줄>' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`
3. 노트북 `~/.ssh/config`에 `Host h200`(HostName 70.12.130.109, User j-k15d101, IdentityFile ~/.ssh/h200_id_ed25519, `LocalForward 127.0.0.1:8100 127.0.0.1:8100`)을 넣는다.
   첫 접속 때 서버 지문이 `SHA256:1Ny4ZoaUXSaG+N+JX21RiYhnW4C+qQEjFCKSjyeUu24`(ED25519)인지 확인한다.
4. 터널을 켜 둔다(데모 서버를 쓰는 동안 계속): `ssh -N h200`
5. `.env`를 바꾼다. 추론 서버로 바로 붙으므로 주피터 토큰이 필요 없다:

```
H200_BASE_URL=http://127.0.0.1:8100
H200_TOKEN=<~/gpu_server/.secret과 같은 값, 5-2>
H200_SSH_HOST=h200
```

### 5-2. 비밀값 확인(서버 버전 10)

같은 서버의 다른 계정도 `127.0.0.1:8100`에 붙을 수 있어서, 서버는 `~/gpu_server/.secret`(권한 600)이 있으면 요청마다 `Authorization: token <비밀값>`을 확인한다(없거나 틀리면 401). 노트북 `.env`의 `H200_TOKEN`에 같은 값을 넣는다. 비밀값을 바꾸면 서버를 다시 켠다.

- 끄기를 SSH로 할 때 `pkill -f "uvicorn server:app"`은 그 문자열이 든 SSH 셸까지 끈다. `pkill -f "[u]vicorn server:app"`처럼 쓴다.
- Git Bash에서 `h200_call.py POST /warmup`은 `/warmup`이 윈도 경로로 바뀐다. 앞에 `MSYS_NO_PATHCONV=1`을 붙인다.

`H200_SSH_HOST`가 있으면 `h200_exec.py`(셸 명령)·`h200_put.py`는 SSH·scp로 돈다. `h200_exec.py --py`만 주피터 커널을 쓰므로 그때는 주피터 토큰이 필요하다.

## 6. 서버 버전 2 (2026-10-28)

| 바뀐 것 | 내용 | 설정 |
|---|---|---|
| 해설 문장 | "~합니다/~있습니다" 완결 문장 규칙, 개조식 끝 자동 수정(`finish_sentence`) | - |
| 장면 묶음 생성 | 장면 여러 개를 한 번에 생성(왼쪽 패딩 배치). 안 되면 자동으로 하나씩 | `DESCRIBE_BATCH=4` (1이면 예전 방식) |
| 질문 답변 스트리밍 | `POST /chat/answer/stream`: 문장이 끝날 때마다 한 줄 JSON `{"sentence": ...}`, 끝에 `{"done": true}` | - |
| 발화 분석 | 예시를 넣어 "아까 노래 다시" 같은 말을 SEEK_SCENE으로 | - |
| `/health` | `version: 2`, `describeBatch` 표시 | - |

파일 바꾸기: 주피터 파일 탐색기에서 `server.py`를 끌어다 올리거나, 로그인된 JupyterLab에서 파일 API(`/user/k15d101/api/contents/gpu_server/server.py`)로 올린다(2026-10-28에는 이 방법으로 올렸고 이전 파일은 `server_v1_backup.py`로 남김).
그 다음 터미널에서:

```bash
cd ~/gpu_server && source .venv/bin/activate
pkill -f 'uvicorn server:app'; sleep 3
nohup uvicorn server:app --host 127.0.0.1 --port 8100 > server.log 2>&1 &
curl -s -X POST http://127.0.0.1:8100/warmup; tail -3 server.log
```

노트북에서 `uv run python scripts/check_h200.py`로 `version: 2`가 보이면 된다. 재생 중 기능은 `.env`의 `H200_CHAT=stt,intent,answer`로 어느 것을 H200에 맡길지 고른다.

## 7. 서버 버전 3 (2026-10-28 저녁) — 생성은 상주 GPU 작업자 스레드 하나로

| 증상 | 원인 | 고친 것 |
|---|---|---|
| 질문 답변 스트리밍이 답 길이와 상관없이 6.3초, 첫 문장도 끝에 옴 | 요청마다 새 스레드에서 `generate`를 돌림. PyTorch는 스레드마다 CUDA 준비(cuBLAS 핸들 등)를 새로 해 약 2.8초를 더 씀(실측: 8토큰이 같은 스레드 0.16초, 새 스레드 2.92초) | 언어 모델 생성은 `ThreadPoolExecutor(max_workers=1)` 작업자 한 스레드에서만. `/warmup`이 그 스레드까지 예열 |
| 일반 요청도 가끔 5~7초 | 스레드풀의 다른 스레드에 걸리면 위 예열을 다시 냄 | 같음 |

실측(노트북에서, 프록시 왕복 포함): 발화 분석 0.7초, 답변 한 번에 0.65초, 스트리밍 첫 문장 0.68초(서버 안 0.41초).

노트북에서 서버 다루기(주피터 토큰만 쓰고, 터미널을 열 필요 없음):

```bash
cd backend
uv run python scripts/h200_exec.py "nvidia-smi; tail -5 ~/gpu_server/server.log"       # H200에서 명령 실행(주피터 커널)
uv run python scripts/h200_put.py ../gpu_server/server.py gpu_server/server.py          # 파일 올리기
```

서버를 다시 켤 때는 커널이 끝나도 살아남게 `setsid`로 띄운다(그냥 `nohup &`만 하면 커널 종료와 함께 꺼진다). `pkill -f` 패턴은 자기 명령줄에 안 걸리게 `ap[p]`처럼 쓴다:

```bash
uv run python scripts/h200_exec.py "cd ~/gpu_server && source .venv/bin/activate && pkill -f 'uvicorn server:ap[p]'; sleep 3; setsid nohup uvicorn server:app --host 127.0.0.1 --port 8100 > server.log 2>&1 < /dev/null & disown; sleep 10; curl -s http://127.0.0.1:8100/health"
uv run python scripts/h200_call.py POST /warmup
```

이전 파일은 `server_v2_backup.py`로 남겼다. 노트북 백엔드는 기본으로 스트리밍을 쓰고, 옛 서버에 붙을 때는 `.env`에 `H200_ANSWER_STREAM=0`.

### 버전 4 (같은 날) — cuDNN 어텐션 끄기

| 증상 | 원인 | 고친 것 |
|---|---|---|
| 새 질문(처음 보는 입력 길이)은 느리고(17토큰 6.4초), 같은 길이를 다시 넣으면 0.3초 | torch 2.11이 H200에서 sdpa 어텐션에 cuDNN 커널을 고르는데, 처음 보는 길이마다 약 0.35초 준비 작업(토큰마다 길이가 늘어나므로 토큰마다) | 모델 로드 때 `torch.backends.cuda.enable_cudnn_sdp(False)` → flash/efficient/math 커널만 사용. 실측: 처음 보는 길이도 0.2~0.4초 |

같은 실험에서 `torch.compile`·정적 캐시·패딩은 효과가 없었다(정적 캐시는 컴파일로 30초 더 걸림).

### 버전 12 (2026-10-30) — 안내 목소리(Supertonic 3)를 H200에서

| 항목 | 내용 |
|---|---|
| 무엇 | `POST /tts {text, voice(F1~F5·M1~M5), format:"mp3"}` → mp3, 헤더 `X-Duration-Ms`. 팀에서는 AI 서버 `/internal/tts`가 부르고 S3 `audio/guide/`에 저장 |
| 왜 | 사용자 기기(CPU)에서 만들면 기기 성능에 따라 문장당 0.6~1.5초. H200은 사용자 수와 상관없이 약 0.04초 |
| 설치 | `pip install -r requirements.txt` (`supertonic==1.3.1`, `onnxruntime-gpu==1.23.2`, `soundfile`). **onnxruntime-gpu 1.24+는 CUDA 13을 찾아 GPU를 못 잡고 CPU로 돈다** → 1.23.x 고정 |
| 느렸던 것 | 새 문장마다 1.6초: cuDNN이 입력 크기가 바뀔 때마다 계산 방법을 다시 찾음 → 길이를 묶음 크기로 맞추고 크기별 세션을 따로 둠(`tts_bucket.py`, 53개, 약 20GB). 켠 뒤 약 45초 동안 뒤에서 미리 만든다(`/health`의 `ttsWarmSessions`가 53이면 끝) |
| 잠금 | Qwen·Whisper와 따로 잠근다(`_tts_lock`). 다른 사람의 해설 만들기가 GPU를 잡고 있어도 안내는 기다리지 않는다 |
| 실측 | 서버 안 0.04초, 터널 너머 왕복 0.1~0.16초(mp3로 받아 전송량 490KB → 약 40KB) |

### 버전 13 (2026-11-02) — 받아쓰기 힌트

`POST /stt`가 `prompt`(영상 제목·인물 이름·목차 단어)를 받아 faster-whisper `initial_prompt`로 넣는다. 질문 녹음에서 고유명사 인식을 높인다. 옛 클라이언트는 보내지 않으므로 그대로 동작한다.
