"""Queue endpoints for continuously scheduled TrueSkill matches."""

import json
import logging
from typing import Literal
from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..redis_client import get_redis

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/rating", tags=["Rating"])


class EnqueueRatingRequest(BaseModel):
    rated_match_id: int
    kind: Literal["validation", "rating"]
    agent1_id: int
    agent1_code: str
    agent2_id: int
    agent2_code: str
    max_moves: int = Field(default=300, ge=50, le=1000)
    callback_url: str = "http://localhost:3000"


@router.post("/enqueue", summary="Enqueue a TrueSkill validation or rating match")
async def enqueue_rating_task(req: EnqueueRatingRequest):
    task = {
        "task_type": "rating",
        "rated_match_id": req.rated_match_id,
        "kind": req.kind,
        "agent1_id": req.agent1_id,
        "agent1_code": req.agent1_code,
        "agent2_id": req.agent2_id,
        "agent2_code": req.agent2_code,
        "max_moves": req.max_moves,
        "callback_url": req.callback_url,
    }
    await get_redis().enqueue_worker_task(json.dumps(task))
    logger.info("Enqueued %s rating task #%s", req.kind, req.rated_match_id)
    return {"ok": True, "queued": True, "rated_match_id": req.rated_match_id}
