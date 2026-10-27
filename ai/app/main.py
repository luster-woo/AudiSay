"""AI 서버 진입점. RabbitMQ 컨슈머와 HTTP(/health, /metrics, /internal/*)를 한 프로세스에서 연다.

실행: uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from redis.asyncio import Redis

from app.config import settings
from app.db import Db
from app.gms.client import GmsClient
from app.gms.rate_limiter import RateLimiter
from app.internal_api import router as internal_router
from app.mq.worker import Worker
from app.pipeline.describe import Describe
from app.pipeline.prepare import Prepare
from app.storage import make_storage

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    cfg = settings()
    redis = Redis(host=cfg.redis_host, port=cfg.redis_port, password=cfg.redis_password or None)
    db = Db(cfg)
    await db.start()
    storage = make_storage(cfg)
    gms = GmsClient(cfg, RateLimiter(redis, cfg.gms_rpm), db)
    handlers = {"job.prepare": Prepare(storage, gms), "job.describe": Describe(storage)}
    worker = Worker(cfg, redis, handlers)
    if cfg.worker_queues.strip():
        await worker.start()
    app.state.redis, app.state.worker = redis, worker
    try:
        yield
    finally:
        await worker.stop()
        await db.stop()
        await redis.aclose()


app = FastAPI(title="AudiSay AI", lifespan=lifespan)
app.include_router(internal_router)


@app.get("/health")
async def health(response: Response) -> dict:
    """Redis와 RabbitMQ 연결을 확인한다. 하나라도 끊겼으면 503."""
    redis_ok = True
    try:
        await app.state.redis.ping()
    except Exception:  # noqa: BLE001
        redis_ok = False
    worker = app.state.worker
    mq_ok = (not settings().worker_queues.strip()) or (worker.connected and worker.conn and not worker.conn.is_closed)
    ok = redis_ok and bool(mq_ok)
    if not ok:
        response.status_code = 503
    return {"status": "UP" if ok else "DOWN", "redis": redis_ok, "rabbitmq": bool(mq_ok)}


@app.get("/metrics")
async def metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
