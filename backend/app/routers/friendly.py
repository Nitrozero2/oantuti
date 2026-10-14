"""
Router: /friendly - Friendly match task queue cho worker.

Worker poll endpoint này để lấy friendly match tasks và chạy local engine.
Frontend enqueue task vào đây thay vì tự chạy step-by-step.
"""

import json
import logging
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel
from typing import Optional

from ..redis_client import get_redis
from ..config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/friendly", tags=["Friendly"])

FRIENDLY_TASK_TTL = 86400  # 24h


class EnqueueFriendlyRequest(BaseModel):
    friendly_match_id: int
    agent1_id: int
    agent1_code: str
    agent2_id: int
    agent2_code: str
    max_moves: int = 300
    callback_url: str = "http://localhost:3000"


@router.post("/enqueue", summary="Enqueue friendly match task cho worker")
async def enqueue_friendly_task(req: EnqueueFriendlyRequest):
    """
    Frontend gọi để đẩy friendly match task vào unified worker queue.
    Worker sẽ poll /worker/tasks/claim để nhận task và chạy local engine.
    """
    redis = get_redis()
    task = {
        "task_type": "friendly",
        "friendly_match_id": req.friendly_match_id,
        "agent1_id": req.agent1_id,
        "agent1_code": req.agent1_code,
        "agent2_id": req.agent2_id,
        "agent2_code": req.agent2_code,
        "max_moves": req.max_moves,
        "callback_url": req.callback_url,
    }
    await redis.enqueue_worker_task(json.dumps(task))
    logger.info(f"Enqueued friendly task for match #{req.friendly_match_id} → unified queue")
    return {"ok": True, "queued": True, "friendly_match_id": req.friendly_match_id}


@router.post("/tasks/claim", summary="[Worker] Lấy friendly task tiếp theo")
async def claim_friendly_task(
    worker_id: str,
    x_worker_secret: str = Header(None, alias="X-Worker-Secret"),
):
    """
    Worker poll endpoint này để lấy friendly match task.
    Trả về task dict hoặc {"task": null} nếu queue rỗng.
    """
    settings = get_settings()
    if x_worker_secret != settings.worker_secret:
        raise HTTPException(status_code=401, detail="Worker secret không hợp lệ.")

    redis = get_redis()
    raw = await redis.dequeue_friendly_task()
    if not raw:
        return {"task": None}

    try:
        task = json.loads(raw)
    except Exception:
        logger.warning(f"Invalid friendly task JSON: {raw[:100]}")
        return {"task": None}

    logger.info(f"Worker {worker_id} claimed friendly task match#{task.get('friendly_match_id')}")
    return {"task": task}


@router.get("/queue/depth", summary="Độ sâu friendly task queue")
async def friendly_queue_depth():
    """Trả về số lượng friendly tasks đang chờ trong queue."""
    redis = get_redis()
    depth = await redis.friendly_queue_depth()
    return {"queue_depth": depth}
