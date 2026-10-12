"""
Router: /tournament - Điều khiển hệ thống ghép trận tự động.
"""

import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional

from ..services.tournament_service import (
    TournamentWorker,
    MatchTask,
    get_tournament_worker,
)
from ..services.judge0_service import Judge0Service

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

@router.post(
    "/sessions/{session_id}/start",
    summary="Bắt đầu ghép trận cho session",
)
async def start_session(session_id: int, req: StartRequest):
    """
    Khởi động worker với danh sách cặp đấu.
    Mỗi cặp: match_id (DB), agent1/2_id + code.
    """
    worker = get_tournament_worker()
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
    await worker.start(
        session_id=session_id,
        pairs=tasks,
        max_parallel=req.config.max_parallel,
        max_moves=req.config.max_moves,
        callback_url=req.callback_url,
    )
    return {"ok": True, "queued": len(tasks), "session_id": session_id}


@router.post("/sessions/{session_id}/pause", summary="Tạm dừng")
async def pause_session(session_id: int):
    worker = get_tournament_worker()
    if worker.get_status().session_id != session_id:
        raise HTTPException(404, f"Session {session_id} không phải session đang chạy.")
    await worker.pause()
    return {"ok": True, "status": "paused"}


@router.post("/sessions/{session_id}/resume", summary="Tiếp tục")
async def resume_session(session_id: int, req: ResumeRequest):
    worker = get_tournament_worker()
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
    await worker.resume(new_pairs=new_tasks)
    return {"ok": True, "status": "running", "added_pairs": len(req.new_pairs)}


@router.post("/sessions/{session_id}/stop", summary="Dừng session")
async def stop_session(session_id: int):
    worker = get_tournament_worker()
    await worker.stop()
    return {"ok": True, "status": "stopped"}


@router.get("/status", response_model=WorkerStatusResponse, summary="Trạng thái worker")
def get_status():
    """Lấy trạng thái hiện tại của tournament worker."""
    worker = get_tournament_worker()
    s = worker.get_status()
    return WorkerStatusResponse(
        status=s.status,
        session_id=s.session_id,
        queue_depth=s.queue_depth,
        active_count=s.active_count,
        completed=s.completed,
        errors=s.errors,
        active_match_ids=s.active_match_ids,
    )


@router.post(
    "/validate-agent",
    response_model=ValidateAgentResponse,
    summary="Kiểm tra agent code",
)
async def validate_agent(req: ValidateAgentRequest):
    """
    Kiểm tra agent code bằng cách chạy thử với Judge0.
    Dùng observation mẫu (bàn cờ ban đầu).
    """
    judge0 = Judge0Service()

    # Observation mẫu: bàn cờ ban đầu, P1 đến lượt
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
            return ValidateAgentResponse(
                valid=False,
                error=result.get("error") or "Agent không trả về nước đi hợp lệ.",
            )

        move = result.get("move")
        if move is None:
            return ValidateAgentResponse(
                valid=False,
                error="Agent trả về None. Cần trả về dict với from_col/from_row/to_col/to_row.",
            )

        # Kiểm tra format nước đi
        required_keys = {"from_col", "from_row", "to_col", "to_row"}
        if not required_keys.issubset(move.keys()):
            return ValidateAgentResponse(
                valid=False,
                error=f"Nước đi thiếu key. Cần: {required_keys}. Nhận được: {set(move.keys())}",
            )

        return ValidateAgentResponse(valid=True)

    except Exception as e:
        logger.error(f"Agent validation error: {e}")
        return ValidateAgentResponse(valid=False, error=str(e))
