# AudiSay AI 서버

RabbitMQ로 해설 생성 단계를 처리하는 워커와, Spring이 부르는 챗봇용 내부 API를 한 프로세스에서 연다.
메시지 형식은 노션 "워커 메시지 명세", 내부 API는 "AI 서버 내부 API (Spring ↔ AI)"를 따른다.

| 큐 | 하는 일 | 상태 |
| --- | --- | --- |
| job.prepare | 유튜브: Gemini 1회로 영상 전체 해설 → `jobs/{jobId}/full.json`, 조각 구간·앞 내용 요약 → `prepare.json` | 구현 |
| job.describe | `full.json`에서 조각 구간을 읽어 누적형 문장 배치·검증 → `chunks/{n}.json` (Gemini 재호출 없음) | 구현 |
| job.merge | `full.json` + `chunks/*.json`(성공한 조각만) → 해설 표 저장(인물 이름은 근거 있을 때만, 목차 키워드) | 구현 |
| job.tts | 상세도 1·2 문장 + 요약 → Gemini TTS → mp3 → S3 `audio/lines/{descriptionId}/{lineId}.mp3` | 구현 |
| line.tts | 상세도 3 문장 음성(사용자가 처음 고를 때) | 구현 |

내부 API(`/internal/stt`, `/internal/chat/intent·seek·answer`)는 제안 구현. 답변은 Redis 리스트 `chat:answer:{chatLogId}`에 문장마다 넣는다. BE와 맞출 것은 `app/internal_api.py` 맨 위 주석 참고.

## 로컬 실행

레포 루트에서 인프라를 띄우고(`docker compose -f infra/docker-compose.local.yml --env-file .env up -d`), 루트 `.env`에 `GMS_API_KEY`, `GMS_GEMINI_BASE_URL`을 채운다.

```bash
cd ai
uv sync
uv run uvicorn app.main:app --port 8000
```

- 교환기·큐는 백엔드가 선언한다. 백엔드 없이 워커만 띄울 때는 `MQ_DECLARE=true`로 두면 워커가 직접 만든다.
- `AWS_S3_BUCKET`이 비어 있으면 결과 파일을 `ai/.storage/`에 저장한다.
- `WORKER_QUEUES`를 비우면 컨슈머 없이 HTTP만 연다.
- `ffmpeg`가 PATH에 있어야 한다(TTS·받아쓰기). Dockerfile에는 들어 있다.
- 확인: `GET /health`(Redis·RabbitMQ 연결), `GET /metrics`(Prometheus)

## 테스트

```bash
uv run pytest
```

GMS를 부르지 않는다(크레딧 0). 가짜 응답으로 prepare → describe를 끝까지 돌리고, 재시도·DLQ 경로를 확인한다.

## 큐 구성 (백엔드와 맞출 것)

| 이름 | 종류 | 설정 |
| --- | --- | --- |
| audisay.job | direct 교환기 | 작업 큐·job.events를 큐 이름과 같은 라우팅 키로 묶음 |
| audisay.retry.10s → job.retry.10s | fanout 교환기 → 큐 | `x-message-ttl` 10000, `x-dead-letter-exchange` audisay.job |
| audisay.retry.30s → job.retry.30s | fanout 교환기 → 큐 | `x-message-ttl` 30000, `x-dead-letter-exchange` audisay.job |
| audisay.dlx → job.dlq | fanout 교환기 → 큐 | `x-message-ttl` 7일 |

실패한 메시지는 attempt를 1 올려 대기 교환기에 원래 큐 이름을 라우팅 키로 보낸다. 대기 큐는 라우팅 키를 지정하지 않아 TTL이 끝나면 원래 큐로 돌아간다. 3번째 실패는 `lastError`를 붙여 audisay.dlx로 보낸다.
