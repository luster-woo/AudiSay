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

    # 처리 규칙 (워커 메시지 명세)
    message_timeout_sec: int = 600
    max_attempts: int = 3


@lru_cache
def settings() -> Settings:
    return Settings()
