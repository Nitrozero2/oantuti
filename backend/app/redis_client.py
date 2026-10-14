"""
Redis client wrapper dùng Upstash REST API (tương thích serverless/Vercel).

Dùng httpx async. Không cần kết nối TCP persistent.

Key conventions:
  worker:queue            → unified queue cho các trận chạy trọn vẹn
  worker:{worker_id}      → JSON heartbeat của worker (TTL: 90s)
  lock:match:{match_id}   → String lock khi cập nhật match state (TTL: 30s)
"""

import json
import logging
import httpx
from typing import Any, Optional

from .config import get_settings

logger = logging.getLogger(__name__)

WORKER_HEARTBEAT_TTL = 90   # giây — worker phải heartbeat mỗi 30s


class RedisClient:
    """Thin async wrapper quanh Upstash Redis REST API."""

    def __init__(self):
        settings = get_settings()
        self._url = settings.upstash_redis_rest_url.rstrip("/")
        self._token = settings.upstash_redis_rest_token

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
        }

    async def _cmd(self, *args) -> Any:
        """Gửi 1 Redis command. args là list[str|int]."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                self._url,
                headers=self._headers(),
                json=list(args),
            )
            resp.raise_for_status()
            data = resp.json()
            if "error" in data:
                raise RuntimeError(f"Redis error: {data['error']}")
            return data.get("result")

    # ── Basic ops ─────────────────────────────────────────────────────────────

    async def set(self, key: str, value: str, ex: Optional[int] = None) -> None:
        if ex:
            await self._cmd("SET", key, value, "EX", ex)
        else:
            await self._cmd("SET", key, value)

    async def get(self, key: str) -> Optional[str]:
        return await self._cmd("GET", key)

    async def delete(self, *keys: str) -> int:
        return await self._cmd("DEL", *keys)

    async def exists(self, key: str) -> bool:
        result = await self._cmd("EXISTS", key)
        return bool(result)

    async def expire(self, key: str, seconds: int) -> None:
        await self._cmd("EXPIRE", key, seconds)

    # ── JSON helpers ──────────────────────────────────────────────────────────

    async def set_json(self, key: str, value: dict, ex: Optional[int] = None) -> None:
        await self.set(key, json.dumps(value), ex=ex)

    async def get_json(self, key: str) -> Optional[dict]:
        raw = await self.get(key)
        if raw is None:
            return None
        return json.loads(raw)

    # ── Atomic SET NX (for distributed lock) ──────────────────────────────────

    async def set_nx(self, key: str, value: str, ex: int) -> bool:
        """SET key value EX ex NX — returns True nếu set thành công (key chưa tồn tại)."""
        result = await self._cmd("SET", key, value, "EX", ex, "NX")
        return result == "OK"

    # ── List ops (job queue) ──────────────────────────────────────────────────

    async def lpush(self, key: str, *values: str) -> int:
        return await self._cmd("LPUSH", key, *values)

    async def rpop(self, key: str) -> Optional[str]:
        """Non-blocking pop từ tail (oldest item)."""
        return await self._cmd("RPOP", key)

    async def llen(self, key: str) -> int:
        return await self._cmd("LLEN", key) or 0

    async def lrange(self, key: str, start: int, stop: int) -> list[str]:
        result = await self._cmd("LRANGE", key, start, stop)
        return result or []

    # ── Friendly match queue ──────────────────────────────────────────────────

    async def enqueue_friendly_task(self, task_json: str) -> None:
        await self.lpush("friendly:queue", task_json)

    async def dequeue_friendly_task(self) -> Optional[str]:
        return await self.rpop("friendly:queue")

    async def friendly_queue_depth(self) -> int:
        return await self.llen("friendly:queue")

    # ── Unified worker queue (tournament + friendly) ──────────────────────────

    WORKER_QUEUE_KEY = "worker:queue"

    async def enqueue_worker_task(self, task_json: str) -> None:
        """Push task vào unified queue. LPUSH → worker RPOP = FIFO."""
        await self.lpush(self.WORKER_QUEUE_KEY, task_json)

    async def dequeue_worker_task(self) -> Optional[str]:
        """Pop task từ unified queue (non-blocking)."""
        return await self.rpop(self.WORKER_QUEUE_KEY)

    async def worker_queue_depth(self) -> int:
        return await self.llen(self.WORKER_QUEUE_KEY)

    # ── Active task tracking (crash recovery) ────────────────────────────────

    async def set_active_task(
        self, worker_id: str, task_id: str, task_json: str, ttl: int = 600
    ) -> None:
        """
        Lưu task đang chạy vào Redis với TTL.
        - key worker:active:{wid}:{tid} = "running" (TTL ngắn = timeout)
        - key worker:task_data:{tid}    = raw task JSON (TTL dài để recover)
        Nếu worker crash → TTL hết → task có thể recover từ task_data.
        """
        # Lưu trạng thái "đang chạy" với TTL = timeout
        await self.set(f"worker:active:{worker_id}:{task_id}", "running", ex=ttl)
        # Lưu raw task data với TTL dài hơn để có thể re-enqueue
        await self.set(f"worker:task_data:{task_id}", task_json, ex=ttl * 3)
        # Track trong list
        await self.lpush(f"worker:active_list:{worker_id}", task_id)
        await self.expire(f"worker:active_list:{worker_id}", ttl + 60)

    async def clear_active_task(self, worker_id: str, task_id: str) -> None:
        """Xóa task khỏi active tracking khi hoàn thành bình thường."""
        await self.delete(
            f"worker:active:{worker_id}:{task_id}",
            f"worker:task_data:{task_id}",
        )

    async def get_stuck_tasks(
        self, worker_id: str, assume_all_stuck: bool = False
    ) -> list[tuple[str, str | None]]:
        """
        Lấy các (task_id, raw_task_json) bị stuck.
        assume_all_stuck=True: worker vừa restart → mọi task trong list đều stuck.
        assume_all_stuck=False: chỉ task nào TTL active key hết mới bị stuck.
        """
        task_ids = await self.lrange(f"worker:active_list:{worker_id}", 0, 99)
        stuck = []
        for tid in task_ids:
            if assume_all_stuck:
                is_stuck = True
            else:
                still_running = await self.exists(f"worker:active:{worker_id}:{tid}")
                is_stuck = not still_running

            if is_stuck:
                raw = await self.get(f"worker:task_data:{tid}")
                stuck.append((tid, raw))
        return stuck

    async def get_all_active_workers(self) -> list[str]:
        """Lấy danh sách worker_id từ heartbeat keys."""
        known = await self.get_json("workers:known") or {}
        return list(known.keys())

    # ── Distributed lock cho match state ─────────────────────────────────────

    async def acquire_match_lock(self, match_id: str, holder: str, ttl: int = 30) -> bool:
        """Cố gắng lấy lock cho match. Trả về True nếu thành công."""
        return await self.set_nx(f"lock:match:{match_id}", holder, ex=ttl)

    async def release_match_lock(self, match_id: str) -> None:
        await self.delete(f"lock:match:{match_id}")

    # ── Worker heartbeat ──────────────────────────────────────────────────────

    async def worker_heartbeat(self, worker_id: str, info: dict) -> None:
        await self.set_json(f"worker:{worker_id}", info, ex=WORKER_HEARTBEAT_TTL)

    async def get_worker(self, worker_id: str) -> Optional[dict]:
        return await self.get_json(f"worker:{worker_id}")

    # ── Health check ──────────────────────────────────────────────────────────

    async def ping(self) -> bool:
        try:
            result = await self._cmd("PING")
            return result == "PONG"
        except Exception as e:
            logger.warning(f"Redis ping failed: {e}")
            return False


# Singleton
_redis_client: Optional[RedisClient] = None


def get_redis() -> RedisClient:
    global _redis_client
    if _redis_client is None:
        _redis_client = RedisClient()
    return _redis_client
