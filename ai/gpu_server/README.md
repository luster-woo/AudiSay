# AudiSay H200 오픈소스 추론 서버

> **팀 서버에서 쓸 때(2026-10-29 이식)**: 데모에서는 노트북이 이 서버를 불렀다. 팀에서는 **AI 워커(`ai/app/inference.py`)**가 부른다.
> 서버 자체(설치·실행·버전 기록)는 아래 데모 내용 그대로다(2026-11-04 버전 22로 맞춤). 바뀌는 것은 연결하는 쪽뿐이다.
>
> | 데모(노트북) | 팀(EC2의 ai 컨테이너) |
> |---|---|
> | 노트북에서 `ssh -N h200`(LocalForward 127.0.0.1:8100) | EC2에서는 H200의 22번에 접속할 수 없어(교육장 내부망), **H200이 EC2로 접속하는 역방향 터널**을 켜 둔다: `ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -i ~/.ssh/ec2_tunnel -R 172.17.0.1:8100:127.0.0.1:8100 tunnel@13.124.245.3`. 리스너는 EC2의 docker 브리지 주소(172.17.0.1:8100)에만 연다(0.0.0.0으로 열지 않는다). EC2 쪽에는 전용 계정 `tunnel`, sshd `GatewayPorts clientspecified`, UFW 허용 규칙이 필요하다(포팅 매뉴얼 6-3). `docker-compose.prod.yml`의 ai에 `extra_hosts: ["host.docker.internal:host-gateway"]` |
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

### 4-1. vLLM 함께 켜기(서버 버전 15, 19)

장면 해설·요약·번역·질문 답변·발화 분석은 vLLM(같은 모델, `127.0.0.1:8200`)에 동시에 보내야 빠르다(망고 커리 8장면 44.8초 → 3.7초, troubleshooting 20·21). 설치는 `experiments/describe_vllm.py` 설명대로 `~/vllm_exp/.venv`에 한 번.

```bash
bash ~/gpu_server/start_vllm.sh   # "ready"가 나오면 됨(약 2분). 이미 켜져 있으면 "already running"
```

- 추론 서버보다 먼저 켜도 나중에 켜도 된다. `/health`의 `"vllm": true`면 쓰는 중.
- vLLM이 꺼져 있거나 실패하면 추론 서버가 알아서 예전 방식(HF, 하나씩)으로 한다. 느려질 뿐 멈추지 않는다. 버전 19부터 HF 8B는 이때 처음 올라오므로(약 17GB) 평소에는 메모리에 없다.
- 끄기: `pkill -f "[b]in/vllm serve"`. 메모리는 GPU0에서 약 24GB(상한 17%, 버전 19 전에는 25%·약 34GB).
- vLLM을 아예 쓰지 않으려면 `VLLM_URL=` (빈 값)으로 추론 서버를 켠다.

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

## 서버 버전 20 (2026-11-04) — 8B vLLM 끄고 32B 하나로

GPU0을 우리 몫만 113GB 쓰고 있어서(32B vLLM 61.5GB + 8B vLLM 24.4GB + 이 서버 27.1GB) 8B vLLM(8200)을 껐다.
장면 해설·요약·번역·질문 답변·발화 분석은 이제 32B vLLM(8201)에 보낸다(`VLLM_URL` 기본값 8201, `VLLM_MODEL` 기본값 32B).

| 실측(H200 안) | 8B 때 | 32B |
|---|---|---|
| 발화 분석 | 약 0.4초 | 0.42초 |
| 질문 답변(스트리밍 전체) | 약 0.4초 | 0.27초 |

8B를 다시 쓰려면 `start_vllm.sh`로 켜고 이 서버를 `VLLM_URL=http://127.0.0.1:8200/v1 VLLM_MODEL=Qwen/Qwen3-VL-8B-Instruct`로 띄운다.
이전 파일은 `server_v19_backup.py`.

## 서버 버전 23 (2026-11-06) — 업로드 영상 파이프라인(상황 먼저)용

| 바뀐 것 | 내용 |
|---|---|
| `/faces` 새로 | 960px·초당 2장 MP4 → 얼굴로 같은 사람끼리 P1, P2…(OpenCV YuNet 얼굴 찾기 + SFace 특징, **CPU**, 10분 영상 약 40초). 비슷한 무리 합치기(0.55), 3초 미만 얼굴은 버림 |
| `/generate_json` | `images`(base64 jpg, 8장까지)를 받으면 글 앞에 붙인다(호칭 정하기 때 얼굴 사진 모음). 깨진 JSON이면 반복 벌점으로 한 번 더, 실패하면 `finish_reason`·끝부분을 응답에 |
| `/speakers` | `model=wespeaker`(WeSpeaker ResNet34 ONNX, onnxruntime)·`same`(같은 사람 기준) 추가. wavlm은 짧은 한국어 대사에서 남녀를 한 화자로 묶었다(기본값은 그대로 wavlm, 워커가 wespeaker·0.5를 보낸다) |
| `/describe` | 32B vLLM이 쓴 장면 해설은 모델 이름도 32B로(8B로 잘못 적혔다) |

새 모델 파일(서버 폴더 `~/gpu_server/models/`, 설치 없이 이미 있는 opencv·onnxruntime으로 돈다):

```bash
mkdir -p ~/gpu_server/models && cd ~/gpu_server/models
curl -sL -o face_detection_yunet_2023mar.onnx https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx
curl -sL -o face_recognition_sface_2021dec.onnx https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx
curl -sL -o voxceleb_resnet34_LM.onnx https://huggingface.co/Wespeaker/wespeaker-voxceleb-resnet34-LM/resolve/main/voxceleb_resnet34_LM.onnx
sha256sum voxceleb_resnet34_LM.onnx   # 7bb2f06e9df17cdf1ef14ee8a15ab08ed28e8d0ef5054ee135741560df2ec068
```
이전 파일은 `server_v22_backup.py`.

## 서버 버전 24 (2026-11-12) — 8201 모델을 Qwen3.8-27B로

지금 모델(Qwen3-VL-32B FP8)이 1년 전 것이라 바꿨다. 근거는 `benchmarks/README.md`: 영상 통째 해설이 30~40% 빠르고 영상 끝까지 쓰며(32B는 마지막 20~40초를 빠뜨림), 줄거리·번역은 약 2배 빠르고 번역 용어(계피·정향)가 맞다.

| 바뀐 것 | 내용 |
|---|---|
| `start_vllm_story.sh` | `Qwen/Qwen3.8-27B-FP8`(`MODEL=`로 바꿈), 메모리 50% → 35%(약 72GB → 50GB), max-num-seqs 4 → 8, `--mm-processor-kwargs` 뺌. 이전 파일은 `start_vllm_story_v23_backup.sh` |
| `server.py` | `STORY_MODEL` 기본값을 새 모델로. 생각 모드는 기본 끔(`chat_template_kwargs.enable_thinking=false`), `VLLM_THINK=1`로 켠다. 8201은 `--reasoning-parser qwen3`로 띄워 켜도 생각 과정이 답과 따로 온다 |

되돌리기: `pkill -f "[v]llm serve .*--port 8201"; bash ~/gpu_server/start_vllm_story_v23_backup.sh` 후 추론 서버를 `STORY_MODEL=Qwen/Qwen3-VL-32B-Instruct-FP8`로 다시 켠다.
이전 파일은 `server_v23_backup.py`.

## 서버 버전 25 (2026-11-12) — 번역 JSON 깨짐

Qwen3.8이 짧은 대사에서 `{"ko": ["잘 써요."}]`처럼 괄호를 거꾸로 닫아, 다시 시켜도 같은 답이라 대사가 영어로 남았다(해리포터 업로드, 최소 3줄).
`/translate`가 vLLM에 JSON 형식(조각 수까지)을 강제하고(`vllm_generate(json_schema=...)`), 그래도 깨진 답이면 `"ko": [` 뒤 따옴표 안 글만 건진다.
같은 대사 8개: 실패 0, 0.8초. 이전 파일은 `server_v24_backup.py`.

## 서버 버전 26 (2026-11-12) — 받아쓰기 구간·장면 제목 시각

| 바뀐 것 | 내용 |
|---|---|
| `/stt` | `word_timestamps=True`, 구간을 첫 단어~끝 단어로. 영화 배경음악을 VAD가 말소리로 봐서 "Knight to E5"(실제 39.7~41.5초)가 1.0~41.4초로 잡혀 0초부터 체스 해설이 나왔다(해리포터) |
| `/describe` | 장면 핵심 사건은 "사진에 보이면" 담기. 줄거리 시각이 몇 초 앞서면 다음 장면 일을 제목으로 썼다(크레페 18~21초 "계란 무게 재기") |

이전 파일은 `server_v25_backup.py`.

## 서버 버전 27 (2026-11-12) — 장면 해설은 사진을 따른다

`DESCRIBE_SYSTEM`: 대사·핵심 사건·소리는 참고이고 사진과 다르면 사진을 따른다. 이전에는 "핵심 사건·소리와 어긋나는 내용은 쓰지 않습니다"라서 해리포터 1분 31초(올빼미, 해리가 잠에서 깸)를 대사("Happy Christmas")를 보고 "학생들이 메리 크리스마스를 인사합니다", 줄거리를 보고 "잠옷 차림으로 방에 들어옵니다"로 썼다. 이전 파일은 `server_v26_backup.py`.

## 서버 버전 28 (2026-11-12) — 받아쓰기 구간을 단어 사이 빈 곳에서 나누기

`/stt`가 단어 사이가 1.5초 이상 비면 구간을 나눈다(`_split_on_gaps`). 해리포터 81초 "Happy Christmas"와 108초 "Happy Christmas, Harry"가 한 구간(81~110초)이라 그 사이 올빼미 장면에 대사가 붙었다. 이전 파일은 `server_v27_backup.py`.

## 서버 버전 29 (2026-11-13) — 줄거리 사건을 그대로 옮기지 않기

`/describe`: 줄거리 단계의 사건은 "작은 사진으로 추정한 것"이라고 알리고, 장면 사진으로 확인되는 부분만 자기 말로 다시 쓰게 한다. 킹스맨(Manners Maketh Man)에서 줄거리가 지어낸 "목을 조릅니다"를 장면 해설이 글자 그대로 level 1에 옮겼다(실제는 바텐더가 통화하다 쓰러짐). 이전 파일은 `server_v28_backup.py`.

## 서버 버전 30 (2026-11-13) — 해설 문장을 근거 사진 시각에 붙이기

`/describe`: 장면 사진마다 시각(`frameMs`)을 받아 "사진1 82초, 사진2 84초…"로 알려 주고, 문장마다 그 일이 보이는 사진 번호(`photo`)를 받는다. 문장은 그 사진 시각에 붙인다(예전에는 장면 시작부터 차례로 붙여서 15초 장면 끝의 일을 장면 시작에 읽었다). `frameMs`가 없는 예전 요청은 그대로. 킹스맨: 총을 겨눔 1:20 → 1:24, STUN 화면 1:30, 인사 1:49 → 1:52(화면과 맞음). 이전 파일은 `server_v29_backup.py`.
