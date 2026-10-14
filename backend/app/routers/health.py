"""
Router: /health - Health check.
"""

from fastapi import APIRouter
from pydantic import BaseModel
from ..config import get_settings
from ..redis_client import get_redis

router = APIRouter(tags=["Health"])


class HealthResponse(BaseModel):
    status: str
    redis_connected: bool
    version: str


@router.get("/health", response_model=HealthResponse, summary="Health check")
async def health_check():
    """Kiểm tra trạng thái API và kết nối Redis."""
    settings = get_settings()
    redis = get_redis()
    redis_ok = await redis.ping()
    return HealthResponse(
        status="ok" if redis_ok else "degraded",
        redis_connected=redis_ok,
        version=settings.app_version,
    )


@router.get("/", summary="Root")
def root():
    """Root endpoint."""
    settings = get_settings()
    return {
        "name": settings.app_name,
        "version": settings.app_version,
        "docs": "/docs",
        "health": "/health",
    }
