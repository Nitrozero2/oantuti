"""
Router: /tournament - Điều khiển hệ thống ghép trận tự động.
"""

import logging
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, Field
from typing import Optional

from ..services.tournament_service import (
    TournamentService,
    MatchTask,
    get_tournament_service,
)
from ..services.judge0_service import Judge0Service
from ..redis_client import get_redis

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tournament", tags=["Tournament"])


# ── Request / Response models ─────────────────────────────────────────────────

class MatchTaskRequest(BaseModel):
    match_id: int
    agent1_id: int
    agent1_code: str
    agent2_id: int
    agent2_code: str


class TournamentConfig(BaseModel):
    max_parallel: int = Field(default=3, ge=1, le=10)
    max_moves: int = Field(default=300, ge=50, le=1000)


class StartRequest(BaseModel):
    pairs: list[MatchTaskRequest]
    config: TournamentConfig = Field(default_factory=TournamentConfig)
    callback_url: str = Field(default="http://localhost:3000")


class ResumeRequest(BaseModel):
    new_pairs: list[MatchTaskRequest] = Field(default_factory=list)
    callback_url: str = Field(default="")


class ValidateAgentRequest(BaseModel):
    code: str = Field(..., min_length=10, max_length=65536)


class ValidateAgentResponse(BaseModel):
    valid: bool
    error: Optional[str] = None


class WorkerStatusResponse(BaseModel):
    status: str
    session_id: Optional[int]
    queue_depth: int
    active_count: int
    completed: int
    errors: int
    active_match_ids: list[str]


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/sessions/{session_id}/start", summary="Bắt đầu ghép trận cho session")
async def start_session(session_id: int, req: StartRequest):
    """
    Enqueue danh sách cặp đấu vào Redis queue.
    Worker ngoài sẽ poll và thực thi.
    """
    svc = get_tournament_service()
    tasks = [
        MatchTask(
            match_id=p.match_id,
            session_id=session_id,
            agent1_id=p.agent1_id,
            agent1_code=p.agent1_code,
            agent2_id=p.agent2_id,
            agent2_code=p.agent2_code,
            max_moves=req.config.max_moves,
        )
        for p in req.pairs
    ]
    await svc.start(
        session_id=session_id,
        pairs=tasks,
        max_parallel=req.config.max_parallel,
        max_moves=req.config.max_moves,
        callback_url=req.callback_url,
    )
    return {"ok": True, "queued": len(tasks), "session_id": session_id}


@router.post("/sessions/{session_id}/pause", summary="Tạm dừng")
async def pause_session(session_id: int):
    svc = get_tournament_service()
    await svc.pause(session_id)
    return {"ok": True, "status": "paused"}


@router.post("/sessions/{session_id}/resume", summary="Tiếp tục")
async def resume_session(session_id: int, req: ResumeRequest):
    svc = get_tournament_service()
    new_tasks = [
        MatchTask(
            match_id=p.match_id,
            session_id=session_id,
            agent1_id=p.agent1_id,
            agent1_code=p.agent1_code,
            agent2_id=p.agent2_id,
            agent2_code=p.agent2_code,
        )
        for p in req.new_pairs
    ] if req.new_pairs else None
    await svc.resume(session_id, new_pairs=new_tasks)
    return {"ok": True, "status": "running", "added_pairs": len(req.new_pairs)}


@router.post("/sessions/{session_id}/stop", summary="Dừng session")
async def stop_session(session_id: int):
    svc = get_tournament_service()
    await svc.stop(session_id)
    return {"ok": True, "status": "stopped"}


@router.get("/status", response_model=WorkerStatusResponse, summary="Trạng thái worker")
async def get_status(session_id: Optional[int] = None):
    """Lấy trạng thái hiện tại của tournament session."""
    svc = get_tournament_service()
    s = await svc.get_status(session_id)
    return WorkerStatusResponse(
        status=s.status,
        session_id=s.session_id,
        queue_depth=s.queue_depth,
        active_count=s.active_count,
        completed=s.completed,
        errors=s.errors,
        active_match_ids=s.active_match_ids,
    )


@router.get("/sessions/active", summary="[Worker] Lấy danh sách session đang running")
async def get_active_sessions(
    x_worker_secret: str = Header(None, alias="X-Worker-Secret"),
):
    """
    Worker gọi để biết session_id nào đang running để poll đúng queue.
    Trả về list session_id đang có status='running' trong Redis.
    """
    from ..config import get_settings
    settings = get_settings()
    if x_worker_secret != settings.worker_secret:
        raise HTTPException(status_code=401, detail="Worker secret không hợp lệ.")

    # Scan các known session IDs từ Redis
    # Vì Upstash không có SCAN, ta lưu list session IDs trong key riêng
    redis = get_redis()
    known_raw = await redis.get_json("tournament:sessions:known")
    known_ids: list[int] = known_raw if isinstance(known_raw, list) else []

    active = []
    for sid in known_ids:
        state = await redis.get_json(f"tournament:session:{sid}")
        if state and state.get("status") == "running":
            queue_depth = await redis.llen(f"tournament:queue:{sid}")
            if queue_depth > 0:
                active.append({
                    "session_id": sid,
                    "queue_depth": queue_depth,
                    "callback_url": state.get("callback_url", ""),
                    "max_moves": state.get("max_moves", 300),
                })

    return {"active_sessions": active}


@router.post("/tasks/claim", summary="[Worker] Lấy task tiếp theo từ tournament queue")
async def claim_tournament_task(
    session_id: int,
    worker_id: str,
    x_worker_secret: str = Header(None, alias="X-Worker-Secret"),
):
    """
    Worker poll endpoint này để lấy tournament match task.
    Trả về task dict hoặc {"task": null} nếu queue rỗng / session dừng.
    """
    from ..config import get_settings
    settings = get_settings()
    if x_worker_secret != settings.worker_secret:
        raise HTTPException(status_code=401, detail="Worker secret không hợp lệ.")

    svc = get_tournament_service()
    task = await svc.next_task(session_id)
    if not task:
        return {"task": None}
    return {"task": task.to_dict()}


class RecordCompletedRequest(BaseModel):
    error: bool = False


@router.post("/sessions/{session_id}/record-completed", summary="[Worker] Báo đã hoàn thành 1 match")
async def record_completed(
    session_id: int,
    req: RecordCompletedRequest,
    x_worker_secret: str = Header(None, alias="X-Worker-Secret"),
):
    """Worker gọi sau khi xong 1 match để cập nhật counter."""
    from ..config import get_settings
    settings = get_settings()
    if x_worker_secret != settings.worker_secret:
        raise HTTPException(status_code=401, detail="Worker secret không hợp lệ.")

    svc = get_tournament_service()
    await svc.record_completed(session_id, error=req.error)
    return {"ok": True}


@router.post(
    "/validate-agent",
    response_model=ValidateAgentResponse,
    summary="Kiểm tra agent code",
)
async def validate_agent(req: ValidateAgentRequest):
    """
    Kiểm tra agent code bằng cách chạy thử với Judge0.
    Gọi trực tiếp Judge0 local — dùng khi backend chạy local.
    """
    judge0 = Judge0Service()

    sample_observation = {
        "current_player": 1,
        "valid_moves": [
            {"from_col": 1, "from_row": 3, "to_col": 2, "to_row": 4, "is_capture": False},
            {"from_col": 1, "from_row": 3, "to_col": 1, "to_row": 4, "is_capture": False},
            {"from_col": 2, "from_row": 2, "to_col": 2, "to_row": 3, "is_capture": False},
        ],
        "board": [None] * 81,
        "piece_counts": {
            "1": {"ROCK": 3, "PAPER": 4, "SCISSORS": 3},
            "2": {"ROCK": 3, "PAPER": 4, "SCISSORS": 3},
        },
        "move_count": 0,
    }

    try:
        result = await judge0.execute_agent(
            agent_code=req.code,
            observation=sample_observation,
        )
        if not result["success"]:
            return ValidateAgentResponse(valid=False, error=result.get("error"))
        move = result.get("move")
        if move is None:
            return ValidateAgentResponse(valid=False, error="Agent trả về None.")
        required_keys = {"from_col", "from_row", "to_col", "to_row"}
        if not required_keys.issubset(move.keys()):
            return ValidateAgentResponse(valid=False, error=f"Nước đi thiếu key: {set(move.keys())}")
        return ValidateAgentResponse(valid=True)
    except Exception as e:
        logger.error(f"Agent validation error: {e}")
        return ValidateAgentResponse(valid=False, error=str(e))
