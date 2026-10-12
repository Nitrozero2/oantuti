"""
Router: /health - Health check.
"""

from fastapi import APIRouter
from ..models import HealthResponse
from ..config import get_settings
from ..services.judge0_service import Judge0Service

router = APIRouter(tags=["Health"])


@router.get("/health", response_model=HealthResponse, summary="Health check")
async def health_check():
    """Kiểm tra trạng thái API và kết nối Judge0."""
    settings = get_settings()
    judge0 = Judge0Service()
    connected = await judge0.check_connection()
    return HealthResponse(
        status="ok",
        judge0_connected=connected,
        judge0_url=settings.judge0_url,
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
