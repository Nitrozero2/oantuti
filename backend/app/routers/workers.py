"""
Router: /workers - Worker management.
"""

import time
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel
from typing import Optional

from ..redis_client import get_redis, WORKER_HEARTBEAT_TTL
from ..config import get_settings

router = APIRouter(prefix="/workers", tags=["Workers"])


class HeartbeatRequest(BaseModel):
    worker_id: str
    judge0_url: str
    active_jobs: int
    max_concurrent: int
    available_slots: int
    timestamp: float


class WorkerInfo(BaseModel):
    worker_id: str
    judge0_url: str
    active_jobs: int
    max_concurrent: int
    available_slots: int
    last_seen: float
    seconds_ago: int


class WorkersStatusResponse(BaseModel):
    workers: list[WorkerInfo]
    total_workers: int
    total_active_jobs: int
    total_available_slots: int
    queue_depth: int


@router.post("/heartbeat", summary="[Worker] Gửi heartbeat")
async def worker_heartbeat(
    req: HeartbeatRequest,
    x_worker_secret: str = Header(..., alias="X-Worker-Secret"),
):
    """Worker gọi mỗi 30s để báo online."""
    settings = get_settings()
    if x_worker_secret != settings.worker_secret:
        raise HTTPException(status_code=401, detail="Worker secret không hợp lệ.")

    redis = get_redis()
    info = {
        "worker_id": req.worker_id,
        "judge0_url": req.judge0_url,
        "active_jobs": req.active_jobs,
        "max_concurrent": req.max_concurrent,
        "available_slots": req.available_slots,
        "last_seen": req.timestamp,
    }
    await redis.worker_heartbeat(req.worker_id, info)

    # Track worker_id trong set để có thể list
    # Lưu danh sách worker IDs (dùng key riêng)
    known = await redis.get_json("workers:known") or {}
    known[req.worker_id] = req.timestamp
    # Xóa worker cũ (quá HEARTBEAT_TTL * 2)
    cutoff = time.time() - WORKER_HEARTBEAT_TTL * 2
    known = {k: v for k, v in known.items() if v > cutoff}
    await redis.set_json("workers:known", known, ex=WORKER_HEARTBEAT_TTL * 3)

    return {"ok": True}


@router.get("/status", response_model=WorkersStatusResponse, summary="Trạng thái workers")
async def workers_status():
    """
    Trả về danh sách worker đang active và trạng thái queue.
    Public endpoint — không cần auth.
    """
    redis = get_redis()
    now = time.time()

    known = await redis.get_json("workers:known") or {}
    workers = []

    for worker_id in known:
        info = await redis.get_worker(worker_id)
        if not info:
            continue
        last_seen = info.get("last_seen", 0)
        # Bỏ qua worker đã im lặng quá HEARTBEAT_TTL giây
        if now - last_seen > WORKER_HEARTBEAT_TTL:
            continue
        workers.append(WorkerInfo(
            worker_id=worker_id,
            judge0_url=info.get("judge0_url", ""),
            active_jobs=info.get("active_jobs", 0),
            max_concurrent=info.get("max_concurrent", 0),
            available_slots=info.get("available_slots", 0),
            last_seen=last_seen,
            seconds_ago=int(now - last_seen),
        ))

    queue_depth = await redis.worker_queue_depth()

    return WorkersStatusResponse(
        workers=workers,
        total_workers=len(workers),
        total_active_jobs=sum(w.active_jobs for w in workers),
        total_available_slots=sum(w.available_slots for w in workers),
        queue_depth=queue_depth,
    )
