"""
Tournament Service - Quản lý ghép trận tự động.

Worker chạy asyncio, thực hiện các trận đấu song song.
Kết quả được POST về callback URL (Next.js API).

Vòng đời:
  idle → running → paused ⇄ running → stopped/completed
"""

import asyncio
import logging
import httpx
from dataclasses import dataclass, field
from typing import Literal, Optional

from .match_service import MatchService, get_match_service

logger = logging.getLogger(__name__)


@dataclass
class MatchTask:
    """Một trận đấu cần chạy."""
    match_id: int          # DB ID (tournament_matches.id)
    session_id: int
    agent1_id: int
    agent1_code: str
    agent2_id: int
    agent2_code: str
    max_moves: int = 300


@dataclass
class WorkerStatus:
    status: Literal["idle", "running", "paused", "stopped"]
    session_id: Optional[int]
    queue_depth: int
    active_count: int
    completed: int
    errors: int
    active_match_ids: list = field(default_factory=list)


class TournamentWorker:
    """
    Asyncio-based tournament worker.
    
    - Chạy tối đa max_parallel trận cùng lúc
    - Start/Pause/Resume/Stop an toàn với asyncio.Lock
    - Kết quả POST về callback_url sau mỗi trận
    """

    def __init__(self):
        self._status: Literal["idle", "running", "paused", "stopped"] = "idle"
        self._session_id: Optional[int] = None
        self._queue: asyncio.Queue = asyncio.Queue()
        self._active: dict[str, asyncio.Task] = {}    # backend_match_id → Task
        self._lock = asyncio.Lock()
        self._max_parallel: int = 3
        self._callback_url: str = ""
        self._max_moves: int = 300
        self._completed: int = 0
        self._errors: int = 0
        self._worker_task: Optional[asyncio.Task] = None
        self._pause_event = asyncio.Event()
        self._pause_event.set()   # Initially not paused (set = "go")

    # ── Public API ──────────────────────────────────────────────────────────

    async def start(
        self,
        session_id: int,
        pairs: list[MatchTask],
        max_parallel: int = 3,
        max_moves: int = 300,
        callback_url: str = "",
    ) -> None:
        async with self._lock:
            if self._status == "running":
                logger.warning("Worker already running, ignoring start.")
                return

            self._session_id = session_id
            self._max_parallel = max(1, min(max_parallel, 10))
            self._max_moves = max_moves
            self._callback_url = callback_url
            self._completed = 0
            self._errors = 0

            # Clear old queue and fill with new pairs
            while not self._queue.empty():
                try:
                    self._queue.get_nowait()
                except asyncio.QueueEmpty:
                    break

            for task in pairs:
                await self._queue.put(task)

            self._status = "running"
            self._pause_event.set()

        # Start worker loop in background
        if self._worker_task is None or self._worker_task.done():
            self._worker_task = asyncio.create_task(self._worker_loop())
        logger.info(f"Tournament worker started: session={session_id}, {len(pairs)} pairs queued.")

    async def add_pairs(self, pairs: list[MatchTask]) -> None:
        """Thêm cặp đấu mới vào queue (dùng khi resume với agent mới)."""
        for task in pairs:
            await self._queue.put(task)
        logger.info(f"Added {len(pairs)} new pairs to queue.")

    async def pause(self) -> None:
        async with self._lock:
            if self._status != "running":
                return
            self._status = "paused"
            self._pause_event.clear()   # Worker loop sẽ block ở await pause_event.wait()
        logger.info("Tournament worker paused.")

    async def resume(self, new_pairs: Optional[list[MatchTask]] = None) -> None:
        async with self._lock:
            if self._status not in ("paused", "stopped"):
                return
            self._status = "running"
            self._pause_event.set()
            if new_pairs:
                for task in new_pairs:
                    await self._queue.put(task)

        # Restart worker loop if it stopped
        if self._worker_task is None or self._worker_task.done():
            self._worker_task = asyncio.create_task(self._worker_loop())
        logger.info(f"Tournament worker resumed. Queue depth: {self._queue.qsize()}")

    async def stop(self) -> None:
        async with self._lock:
            self._status = "stopped"
            self._pause_event.set()  # Unblock if paused so worker can exit
            # Drain queue
            drained = 0
            while not self._queue.empty():
                try:
                    self._queue.get_nowait()
                    drained += 1
                except asyncio.QueueEmpty:
                    break

        # Wait for active matches to finish (don't cancel them)
        if self._active:
            logger.info(f"Waiting for {len(self._active)} active matches to finish...")
            await asyncio.gather(*self._active.values(), return_exceptions=True)

        logger.info("Tournament worker stopped.")

    def get_status(self) -> WorkerStatus:
        return WorkerStatus(
            status=self._status,
            session_id=self._session_id,
            queue_depth=self._queue.qsize(),
            active_count=len(self._active),
            completed=self._completed,
            errors=self._errors,
            active_match_ids=list(self._active.keys()),
        )

    # ── Internal worker loop ─────────────────────────────────────────────────

    async def _worker_loop(self) -> None:
        """Main loop: pull tasks from queue and run up to max_parallel concurrently."""
        logger.info("Worker loop started.")
        while True:
            # Check stop
            if self._status == "stopped":
                break

            # Wait if paused
            await self._pause_event.wait()

            if self._status == "stopped":
                break

            # Wait if at capacity
            if len(self._active) >= self._max_parallel:
                await asyncio.sleep(0.5)
                continue

            # Get next task
            try:
                task = self._queue.get_nowait()
            except asyncio.QueueEmpty:
                # Queue empty
                if len(self._active) == 0:
                    # All done
                    if self._status == "running":
                        self._status = "idle"
                        logger.info("All matches completed, worker idle.")
                    break
                await asyncio.sleep(1.0)
                continue

            # Launch match
            match_task = asyncio.create_task(self._run_match(task))
            key = f"db_{task.match_id}"
            self._active[key] = match_task
            match_task.add_done_callback(lambda t, k=key: self._active.pop(k, None))

        logger.info("Worker loop exited.")

    async def _run_match(self, task: MatchTask) -> None:
        """Chạy 1 trận đấu và POST kết quả về callback."""
        logger.info(f"Starting match db_id={task.match_id} (a{task.agent1_id} vs a{task.agent2_id})")
        match_service = get_match_service()

        # Notify callback: match started
        await self._post_callback("match-started", {
            "match_id": task.match_id,
            "session_id": task.session_id,
        })

        try:
            # Tạo match trong MatchService
            match_data = match_service.create_match(
                agent1_code=task.agent1_code,
                agent2_code=task.agent2_code,
                max_moves=task.max_moves,
            )
            backend_match_id = match_data.match_id

            # Chạy đến khi kết thúc
            result = await match_service.run_to_end(backend_match_id)

            # Parse moves history từ steps
            moves_history = []
            for step in result.get("steps", []):
                if step.move:
                    moves_history.append({
                        "move_number": step.step_number,
                        "player": step.player,
                        "from_col": step.move.from_col,
                        "from_row": step.move.from_row,
                        "to_col": step.move.to_col,
                        "to_row": step.move.to_row,
                        "from_pos": step.move.from_pos,
                        "to_pos": step.move.to_pos,
                        "piece_type": None,   # Not tracked in current engine
                        "captured_type": step.captured.type if step.captured else None,
                    })

            # Xác định outcome
            winner = result.get("winner")
            win_reason = result.get("win_reason", "")
            is_infra_error = False

            # Phân biệt lỗi hạ tầng vs thua bình thường
            if winner is not None:
                outcome = "agent1" if winner == 1 else "agent2"
                winner_agent_id = task.agent1_id if winner == 1 else task.agent2_id
            elif result.get("game_over"):
                outcome = "draw"
                winner_agent_id = None
            else:
                # Không kết thúc bình thường → infra error
                is_infra_error = True
                outcome = None
                winner_agent_id = None

            # Kiểm tra lỗi từ step cuối
            last_step = result.get("steps", [{}])[-1] if result.get("steps") else {}
            if hasattr(last_step, 'error') and last_step.error:
                # Agent error - không phải infra error, đây là thua hợp lệ
                pass

            await self._post_callback("match-result", {
                "match_id": task.match_id,
                "session_id": task.session_id,
                "backend_match_id": backend_match_id,
                "agent1_id": task.agent1_id,
                "agent2_id": task.agent2_id,
                "outcome": outcome,
                "winner_agent_id": winner_agent_id,
                "win_reason": win_reason,
                "total_moves": result.get("total_moves", 0),
                "is_infra_error": is_infra_error,
                "infra_error_detail": result.get("aborted_reason"),
                "moves_history": moves_history,
            })

            self._completed += 1
            logger.info(f"Match db_id={task.match_id} done. Outcome={outcome}, moves={result.get('total_moves',0)}")

            # Cleanup backend match
            match_service.delete_match(backend_match_id)

        except Exception as e:
            logger.error(f"Match db_id={task.match_id} FAILED: {e}", exc_info=True)
            self._errors += 1
            await self._post_callback("match-result", {
                "match_id": task.match_id,
                "session_id": task.session_id,
                "backend_match_id": None,
                "agent1_id": task.agent1_id,
                "agent2_id": task.agent2_id,
                "outcome": None,
                "winner_agent_id": None,
                "win_reason": "",
                "total_moves": 0,
                "is_infra_error": True,
                "infra_error_detail": str(e),
                "moves_history": [],
            })

    async def _post_callback(self, event: str, data: dict) -> None:
        """POST kết quả về Next.js callback URL."""
        if not self._callback_url:
            return
        url = f"{self._callback_url}/api/tournament/match-result"
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(url, json=data)
                if resp.status_code not in (200, 201):
                    logger.warning(f"Callback {event} returned {resp.status_code}: {resp.text[:100]}")
        except Exception as e:
            logger.warning(f"Callback {event} failed: {e}")


# Singleton
_worker: Optional[TournamentWorker] = None


def get_tournament_worker() -> TournamentWorker:
    global _worker
    if _worker is None:
        _worker = TournamentWorker()
    return _worker
