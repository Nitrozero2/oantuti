"""
Tournament Service - Quản lý ghép trận tự động.

Thay vì asyncio worker chạy trong process, giờ enqueue job vào Redis.
Worker bên ngoài (worker/worker.py) sẽ poll và thực thi.

Tournament state lưu trong Redis:
  tournament:session:{session_id}  → {status, config, callback_url, ...}
  tournament:queue:{session_id}    → List[MatchTask JSON]  (LPUSH/RPOP)
"""

import json
import logging
import time
import httpx
from dataclasses import dataclass, field
from typing import Literal, Optional

from ..redis_client import get_redis

logger = logging.getLogger(__name__)


@dataclass
class MatchTask:
    """Một trận đấu cần chạy trong tournament."""
    match_id: int          # DB ID (tournament_matches.id)
    session_id: int
    agent1_id: int
    agent1_code: str
    agent2_id: int
    agent2_code: str
    max_moves: int = 300
    callback_url: str = ""

    def to_dict(self) -> dict:
        return {
            "match_id": self.match_id,
            "session_id": self.session_id,
            "agent1_id": self.agent1_id,
            "agent1_code": self.agent1_code,
            "agent2_id": self.agent2_id,
            "agent2_code": self.agent2_code,
            "max_moves": self.max_moves,
            "callback_url": self.callback_url,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "MatchTask":
        # Chỉ lấy các field có trong dataclass để tránh lỗi unexpected keyword
        known = {f.name for f in cls.__dataclass_fields__.values()}  # type: ignore
        return cls(**{k: v for k, v in d.items() if k in known})


@dataclass
class WorkerStatus:
    status: Literal["idle", "running", "paused", "stopped"]
    session_id: Optional[int]
    queue_depth: int
    active_count: int
    completed: int
    errors: int
    active_match_ids: list = field(default_factory=list)


def _session_key(session_id: int) -> str:
    return f"tournament:session:{session_id}"

def _queue_key(session_id: int) -> str:
    return f"tournament:queue:{session_id}"

def _active_key(session_id: int) -> str:
    return f"tournament:active:{session_id}"


class TournamentService:
    """
    Enqueue tournament matches vào Redis.
    Worker ngoài sẽ poll và chạy.
    """

    def __init__(self):
        self._redis = get_redis()

    async def start(
        self,
        session_id: int,
        pairs: list[MatchTask],
        max_parallel: int = 3,
        max_moves: int = 300,
        callback_url: str = "",
    ) -> None:
        state = {
            "session_id": session_id,
            "status": "running",
            "max_parallel": max_parallel,
            "max_moves": max_moves,
            "callback_url": callback_url,
            "started_at": time.time(),
            "completed": 0,
            "errors": 0,
        }
        await self._redis.set_json(_session_key(session_id), state, ex=86400 * 7)

        # Enqueue tất cả pairs vào unified worker queue
        for task in pairs:
            task_dict = task.to_dict()
            task_dict["task_type"] = "tournament"
            await self._redis.enqueue_worker_task(json.dumps(task_dict))

        # Track session ID để worker có thể discover
        known_raw = await self._redis.get_json("tournament:sessions:known")
        known: list[int] = known_raw if isinstance(known_raw, list) else []
        if session_id not in known:
            known.append(session_id)
        # Giữ 20 sessions gần nhất
        if len(known) > 20:
            known = known[-20:]
        await self._redis.set_json("tournament:sessions:known", known, ex=86400 * 30)

        logger.info(f"Tournament session {session_id} started: {len(pairs)} pairs enqueued")

    async def pause(self, session_id: int) -> None:
        state = await self._redis.get_json(_session_key(session_id))
        if state:
            state["status"] = "paused"
            await self._redis.set_json(_session_key(session_id), state, ex=86400 * 7)

    async def resume(self, session_id: int, new_pairs: Optional[list[MatchTask]] = None) -> None:
        state = await self._redis.get_json(_session_key(session_id))
        if state:
            state["status"] = "running"
            await self._redis.set_json(_session_key(session_id), state, ex=86400 * 7)
        if new_pairs:
            for task in new_pairs:
                task_dict = task.to_dict()
                task_dict["task_type"] = "tournament"
                await self._redis.enqueue_worker_task(json.dumps(task_dict))

    async def stop(self, session_id: int) -> None:
        state = await self._redis.get_json(_session_key(session_id))
        if state:
            state["status"] = "stopped"
            await self._redis.set_json(_session_key(session_id), state, ex=86400 * 7)
        # Drain queue
        await self._redis.delete(_queue_key(session_id))

    async def get_status(self, session_id: Optional[int] = None) -> WorkerStatus:
        if session_id is None:
            return WorkerStatus(
                status="idle", session_id=None,
                queue_depth=0, active_count=0, completed=0, errors=0,
            )
        state = await self._redis.get_json(_session_key(session_id))
        if not state:
            return WorkerStatus(
                status="idle", session_id=session_id,
                queue_depth=0, active_count=0, completed=0, errors=0,
            )
        queue_depth = await self._redis.llen(_queue_key(session_id))
        active_raw = await self._redis.get_json(_active_key(session_id)) or {}
        return WorkerStatus(
            status=state.get("status", "idle"),
            session_id=session_id,
            queue_depth=queue_depth,
            active_count=len(active_raw),
            completed=state.get("completed", 0),
            errors=state.get("errors", 0),
            active_match_ids=list(active_raw.keys()),
        )

    async def next_task(self, session_id: int) -> Optional[MatchTask]:
        """Worker gọi để lấy task tiếp theo từ queue của session."""
        state = await self._redis.get_json(_session_key(session_id))
        if not state or state.get("status") != "running":
            return None
        raw = await self._redis.rpop(_queue_key(session_id))
        if not raw:
            return None
        task_dict = json.loads(raw)
        # Inject callback_url và max_moves từ session state vào task
        task_dict["callback_url"] = state.get("callback_url", "")
        if "max_moves" not in task_dict or not task_dict["max_moves"]:
            task_dict["max_moves"] = state.get("max_moves", 300)
        return MatchTask.from_dict(task_dict)

    async def record_completed(self, session_id: int, error: bool = False) -> None:
        """Worker gọi sau khi hoàn thành 1 match."""
        state = await self._redis.get_json(_session_key(session_id))
        if state:
            if error:
                state["errors"] = state.get("errors", 0) + 1
            else:
                state["completed"] = state.get("completed", 0) + 1
            # Auto-complete session khi queue rỗng
            qd = await self._redis.llen(_queue_key(session_id))
            if qd == 0 and state.get("status") == "running":
                state["status"] = "idle"
            await self._redis.set_json(_session_key(session_id), state, ex=86400 * 7)

    async def post_callback(self, callback_url: str, event: str, data: dict) -> None:
        """POST kết quả về Next.js."""
        if not callback_url:
            return
        url = f"{callback_url}/api/tournament/match-result"
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(url, json=data)
                if resp.status_code not in (200, 201):
                    logger.warning(f"Callback {event} returned {resp.status_code}: {resp.text[:100]}")
        except Exception as e:
            logger.warning(f"Callback {event} failed: {e}")


# Singleton
_tournament_service: Optional[TournamentService] = None


def get_tournament_service() -> TournamentService:
    global _tournament_service
    if _tournament_service is None:
        _tournament_service = TournamentService()
    return _tournament_service


# Backward compat alias
def get_tournament_worker() -> TournamentService:
    return get_tournament_service()
