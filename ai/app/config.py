"""환경변수 설정. 값은 레포 루트 .env(로컬) 또는 infra/.env(서버)에서 읽는다."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    # RabbitMQ
    rabbitmq_host: str = "localhost"
    rabbitmq_port: int = 5672
    rabbitmq_default_user: str = "audisay"
    rabbitmq_default_pass: str = "audisay"
    # 교환기·큐는 백엔드(Spring)가 선언한다. 워커는 이미 있는 큐에 붙기만 한다.
    # 백엔드 없이 워커만 띄워 볼 때만 true로 둔다
    mq_declare: bool = False
    # 이 워커가 받을 큐 (쉼표로 구분). 비우면 컨슈머 없이 HTTP만 연다
    worker_queues: str = "job.prepare,job.describe"
    worker_prefetch: int = 2
    worker_id: str = "ai-worker-1"

    # Redis
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_password: str = "audisay"

    # PostgreSQL (ai_call_logs 기록, 나중에 해설 테이블 저장)
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_db: str = "audisay"
    postgres_user: str = "audisay"
    postgres_password: str = "audisay"

    # S3. 버킷이 비어 있으면 로컬 폴더(local_storage_dir)에 저장한다(개발용)
    aws_region: str = "ap-northeast-2"
    aws_s3_bucket: str = ""
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    local_storage_dir: str = "./.storage"

    # GMS
    gms_api_key: str = ""
    gms_gemini_base_url: str = ""
    # GMS 호출 한도(모든 워커 합산, 분당). 레이트 리미터가 Redis로 나눠 쓴다
    gms_rpm: int = 60

    # 내부 API (Spring → AI)
    ai_internal_token: str = ""

    # H200 오픈소스 추론 서버(ai/gpu_server). 업로드 영상(LOCAL) 분석과 재생 중 받아쓰기·발화 분석·답변에 쓴다
    # remote: H200_BASE_URL로 부른다(SSH 터널이면 http://127.0.0.1:8100). mock: 시험용 가짜 응답(GPU·크레딧 0)
    inference_mode: str = "mock"
    h200_base_url: str = ""
    h200_token: str = ""  # gpu_server의 ~/gpu_server/.secret 값 또는 주피터 토큰. "Authorization: token <값>"으로 보낸다
    h200_chat: str = "stt,intent,answer,tts"  # 재생 중 기능 가운데 H200에 먼저 맡길 것. 실패하면 GMS로(tts는 실패하면 503 → 브라우저 음성)
    h200_answer_stream: bool = True  # 질문 답변을 H200 /chat/answer/stream으로(문장마다). 옛 서버면 false
    # 업로드 영상 해설 엔진: video(기본, H200 32B가 영상을 1분 조각으로 보고 씀, gpu_server 버전 22 이상) |
    # opensource(H200 8B 장면별) | gemini(영상 파일을 Gemini에 넣음, 크레딧). 실패하면 video → opensource → gemini 순으로 대체
    upload_engine: str = "video"
    # H200 번역 가운데 의심스러운 것을 Gemini로 다시: failed(기본) | all | off
    translate_fix: str = "failed"
    # 시리즈 등장인물 사전 폴더(ai/data/characters)
    characters_dir: str = "data/characters"

    # 처리 규칙 (워커 메시지 명세)
    message_timeout_sec: int = 600
    max_attempts: int = 3


@lru_cache
def settings() -> Settings:
    return Settings()
