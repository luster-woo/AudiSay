"""단계 사이 결과 파일 저장 (워커 메시지 명세 1장 '중간 결과 저장 위치').

버킷(AWS_S3_BUCKET)이 있으면 S3, 없으면 로컬 폴더에 같은 키로 저장한다(개발·테스트용).
boto3는 동기라 스레드에서 돌린다.
"""
import asyncio
import json
from pathlib import Path
from typing import Any, Protocol

from app.config import Settings


class Storage(Protocol):
    async def exists(self, key: str) -> bool: ...
    async def get_json(self, key: str) -> Any: ...
    async def put_json(self, key: str, obj: Any) -> None: ...
    async def put_bytes(self, key: str, data: bytes, content_type: str) -> None: ...


def _dumps(obj: Any) -> bytes:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode()


class LocalStorage:
    def __init__(self, root: str):
        self.root = Path(root)

    def _p(self, key: str) -> Path:
        return self.root / key

    async def exists(self, key: str) -> bool:
        return self._p(key).exists()

    async def get_json(self, key: str) -> Any:
        return json.loads(self._p(key).read_text(encoding="utf-8"))

    async def put_json(self, key: str, obj: Any) -> None:
        await self.put_bytes(key, _dumps(obj), "application/json")

    async def put_bytes(self, key: str, data: bytes, content_type: str) -> None:
        p = self._p(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)


class S3Storage:
    def __init__(self, cfg: Settings):
        import boto3

        kw = {"region_name": cfg.aws_region}
        if cfg.aws_access_key_id:
            kw.update(aws_access_key_id=cfg.aws_access_key_id, aws_secret_access_key=cfg.aws_secret_access_key)
        self.s3 = boto3.client("s3", **kw)
        self.bucket = cfg.aws_s3_bucket

    async def exists(self, key: str) -> bool:
        def head():
            try:
                self.s3.head_object(Bucket=self.bucket, Key=key)
                return True
            except self.s3.exceptions.ClientError as e:
                if e.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                    return False
                raise
        return await asyncio.to_thread(head)

    async def get_json(self, key: str) -> Any:
        def get():
            return json.loads(self.s3.get_object(Bucket=self.bucket, Key=key)["Body"].read())
        return await asyncio.to_thread(get)

    async def put_json(self, key: str, obj: Any) -> None:
        await self.put_bytes(key, _dumps(obj), "application/json")

    async def put_bytes(self, key: str, data: bytes, content_type: str) -> None:
        await asyncio.to_thread(self.s3.put_object, Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)


def make_storage(cfg: Settings) -> Storage:
    return S3Storage(cfg) if cfg.aws_s3_bucket else LocalStorage(cfg.local_storage_dir)
