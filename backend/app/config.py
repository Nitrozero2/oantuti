"""
Cấu hình ứng dụng từ environment variables / .env file.
"""

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Judge0
    judge0_url: str = "http://localhost:2358"
    judge0_api_key: str = ""
    judge0_language_id: int = 71        # Python 3 trên Judge0
    judge0_timeout_seconds: int = 10    # Timeout thực thi code agent
    judge0_memory_limit_kb: int = 131072  # 128 MB

    # App
    app_name: str = "OTTv2 Tournament API"
    app_version: str = "1.0.0"
    debug: bool = False
    max_moves_per_match: int = 500      # Giới hạn số nước để tránh vòng lặp vô hạn

    # CORS (cho frontend Vercel)
    cors_origins: list[str] = ["*"]

    # Upstash Redis
    upstash_redis_rest_url: str = ""
    upstash_redis_rest_token: str = ""

    # Worker auth — worker gửi header X-Worker-Secret khi push kết quả
    worker_secret: str = "change-me-in-production"

    # Job TTL (giây) — job tự xóa khỏi Redis sau thời gian này
    job_ttl_seconds: int = 3600          # 1 giờ
    match_ttl_seconds: int = 86400       # 24 giờ

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
