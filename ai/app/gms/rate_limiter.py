"""모든 워커가 함께 쓰는 GMS 호출 한도 (워커 메시지 명세 1장).

Redis에 1분 단위 칸을 두고 호출마다 1씩 센다. 한도를 넘으면 다음 칸이 열릴 때까지 기다린다.
"""
import asyncio
import time

from redis.asyncio import Redis

from app.errors import WorkerError

# 칸 값을 1 올리고, 처음 만든 칸이면 만료 시간을 건다. 올린 뒤 값을 돌려준다
_INCR = """
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n
"""


class RateLimiter:
    def __init__(self, redis: Redis, rpm: int, key: str = "ai:gms:rpm"):
        self.redis, self.rpm, self.key = redis, rpm, key
        self._incr = redis.register_script(_INCR)

    async def acquire(self, max_wait_sec: float = 120) -> None:
        deadline = time.time() + max_wait_sec
        while True:
            window = int(time.time() // 60)
            n = await self._incr(keys=[f"{self.key}:{window}"], args=[120])
            if n <= self.rpm:
                return
            wait = (window + 1) * 60 - time.time() + 0.05
            if time.time() + wait > deadline:
                raise WorkerError("AI_LIMIT", f"GMS 호출 한도({self.rpm}/분) 대기 시간 초과")
            await asyncio.sleep(wait)
