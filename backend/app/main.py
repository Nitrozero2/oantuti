"""
OTTv2 Tournament API - Entry point FastAPI.

Khởi động: uvicorn app.main:app --reload
"""

import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routers.health import router as health_router
from .routers.tournament import router as tournament_router
from .routers.workers import router as workers_router
from .routers.friendly import router as friendly_router
from .routers.workers_queue import router as workers_queue_router
from .routers.rating import router as rating_router

# Cấu hình logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="""
## OTTv2 Tournament API (Distributed)

API quản lý trận đấu phân tán với Redis Queue + Worker.

### Flow chạy trọn trận
Frontend enqueue một task tournament, friendly hoặc rating vào unified worker queue.
Worker chạy toàn bộ trận cục bộ, sau đó callback kết quả và lịch sử nước đi về frontend.

### Format agent
```python
def agent(observation, configuration):
    # observation["valid_moves"]: list[{"from_col", "from_row", "to_col", "to_row", "is_capture"}]
    # observation["board"]: list[81] → None hoặc {"player": 1|2, "type": "ROCK"|"PAPER"|"SCISSORS"}
    # observation["current_player"]: 1 hoặc 2
    return {"from_col": 2, "from_row": 4, "to_col": 2, "to_row": 5}
```
    """,
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS middleware (cho frontend Vercel)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Đăng ký routers
app.include_router(health_router)
app.include_router(workers_router)
app.include_router(tournament_router)
app.include_router(friendly_router)
app.include_router(workers_queue_router)
app.include_router(rating_router)
