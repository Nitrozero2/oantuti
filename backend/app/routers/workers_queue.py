"""
Router: /worker - Unified worker task queue với crash recovery.

Flow:
  1. Worker claim task → backend lưu task vào worker:active:{wid}:{tid} với TTL
  2. Worker chạy xong → POST /worker/tasks/done → backend xóa active key
  3. Nếu worker crash → TTL hết → task có thể recover
  4. Worker khi restart → POST /worker/tasks/recover → re-enqueue stuck tasks
"""

import json
import time
import uuid
import logging
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel
from typing import Optional

from ..redis_client import get_redis
from ..config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/worker", tags=["Worker Queue"])

# TTL cho active task = max thời gian 1 trận (300 nước × ~1s = 5 phút + buffer)
ACTIVE_TASK_TTL = 600  # 10 phút


class TaskDoneRequest(BaseModel):
    worker_id: str
    task_id: str  # ID nhận từ /tasks/claim


class WorkerQueueDepthResponse(BaseModel):
    queue_depth: int


def _requires_secret(x_worker_secret: Optional[str]) -> None:
    settings = get_settings()
    if x_worker_secret != settings.worker_secret:
        raise HTTPException(status_code=401, detail="Worker secret không hợp lệ.")


@router.post("/tasks/claim", summary="[Worker] Lấy task tiếp theo từ unified queue")
async def claim_worker_task(
    worker_id: str,
    x_worker_secret: str = Header(None, alias="X-Worker-Secret"),
):
    """
    Worker poll endpoint duy nhất.
    Khi claim thành công:
    - Task được lưu vào Redis active tracking với TTL 10 phút
    - Nếu worker crash trong 10 phút → task có thể recover
    Trả về task dict + task_id (dùng để done/fail), hoặc {"task": null}.
    """
    _requires_secret(x_worker_secret)

    redis = get_redis()
    raw = await redis.dequeue_worker_task()
    if not raw:
        return {"task": None}

    try:
        task = json.loads(raw)
    except Exception:
        logger.warning(f"Invalid task JSON: {raw[:100]}")
        return {"task": None}

    # Gán task_id duy nhất để track
    task_id = task.get("task_id") or str(uuid.uuid4())[:8]
    task["task_id"] = task_id

    # Lưu vào active tracking với TTL
    await redis.set_active_task(
        worker_id=worker_id,
        task_id=task_id,
        task_json=raw,  # lưu raw để có thể re-enqueue
        ttl=ACTIVE_TASK_TTL,
    )

    task_type = task.get("task_type", "unknown")
    match_label = task.get("match_id") or task.get("friendly_match_id")
    logger.info(f"Worker {worker_id} claimed {task_type} task#{match_label} (tid={task_id})")
    return {"task": task, "task_id": task_id}


@router.post("/tasks/done", summary="[Worker] Báo task hoàn thành")
async def task_done(
    req: TaskDoneRequest,
    x_worker_secret: str = Header(None, alias="X-Worker-Secret"),
):
    """
    Worker gọi sau khi hoàn thành task (thành công hoặc thất bại).
    Xóa task khỏi active tracking.
    """
    _requires_secret(x_worker_secret)

    redis = get_redis()
    await redis.clear_active_task(req.worker_id, req.task_id)
    logger.info(f"Worker {req.worker_id} done task {req.task_id}")
    return {"ok": True}


@router.post("/tasks/recover", summary="[Worker] Re-enqueue tasks bị stuck do crash")
async def recover_tasks(
    worker_id: str,
    x_worker_secret: str = Header(None, alias="X-Worker-Secret"),
):
    """
    Worker gọi khi khởi động.
    Vì worker vừa restart → mọi task trong active_list đều bị stuck (worker đã chết).
    Re-enqueue tất cả vào queue để được xử lý lại.
    """
    _requires_secret(x_worker_secret)

    redis = get_redis()
    # assume_all_stuck=True vì worker vừa restart, không thể còn task nào đang chạy
    stuck = await redis.get_stuck_tasks(worker_id, assume_all_stuck=True)

    recovered = 0
    lost = 0

    for task_id, raw_task in stuck:
        if raw_task:
            await redis.enqueue_worker_task(raw_task)
            await redis.clear_active_task(worker_id, task_id)
            logger.info(f"Recovered + re-enqueued task {task_id} (was on worker {worker_id})")
            recovered += 1
        else:
            logger.error(f"Lost task {task_id} — data expired, cannot recover")
            await redis.clear_active_task(worker_id, task_id)
            lost += 1

    if recovered or lost:
        logger.info(f"Worker {worker_id} recovery: {recovered} re-enqueued, {lost} lost")

    return {"ok": True, "recovered": recovered, "lost": lost}


@router.post("/tasks/recover-all", summary="[Admin] Re-enqueue tất cả stuck tasks")
async def recover_all_tasks(
    x_worker_secret: str = Header(None, alias="X-Worker-Secret"),
):
    """Scan tất cả workers, re-enqueue các task bị stuck."""
    _requires_secret(x_worker_secret)

    redis = get_redis()
    all_workers = await redis.get_all_active_workers()

    total_recovered = 0
    total_lost = 0

    for wid in all_workers:
        stuck = await redis.get_stuck_tasks(wid)
        for task_id, raw_task in stuck:
            if raw_task:
                await redis.enqueue_worker_task(raw_task)
                await redis.clear_active_task(wid, task_id)
                total_recovered += 1
                logger.info(f"Admin recovered task {task_id} from worker {wid}")
            else:
                total_lost += 1

    return {"ok": True, "total_recovered": total_recovered, "total_lost": total_lost}


@router.get("/queue/depth", response_model=WorkerQueueDepthResponse,
            summary="Độ sâu unified worker queue")
async def worker_queue_depth():
    redis = get_redis()
    depth = await redis.worker_queue_depth()
    return {"queue_depth": depth}
