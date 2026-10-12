"""
OTTv2 Tournament API - Entry point FastAPI.

Khởi động: uvicorn app.main:app --reload
"""

import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routers.matches import router as matches_router
from .routers.health import router as health_router
from .routers.tournament import router as tournament_router

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
## OTTv2 Tournament API

API quản lý trận đấu Oẳn Tù Tì v2 giữa các agent AI.

### Luật chơi
- Bàn cờ 9x9, cột a-i, hàng 1-9
- 3 loại quân: ROCK (✊ thắng SCISSORS), PAPER (✋ thắng ROCK), SCISSORS (✌️ thắng PAPER)
- Di chuyển kiểu Vua cờ vua: 8 hướng, 1 ô mỗi bước
- Player 1 chiếm i9 hoặc tiêu diệt hết 1 loại quân của P2 → thắng
- Player 2 chiếm a1 hoặc tiêu diệt hết 1 loại quân của P1 → thắng

### Workflow cơ bản
1. `POST /matches` với code của 2 agent → nhận `match_id`
2. `POST /matches/{match_id}/step` → chạy từng nước (recommended cho frontend)
3. `POST /matches/{match_id}/run` → chạy đến khi xong
4. `GET /matches/{match_id}` → lấy trạng thái hiện tại

### Format agent
Agent là hàm Python với signature:
```python
def agent(observation, configuration):
    # observation["valid_moves"]: list[{"from_col", "from_row", "to_col", "to_row", "is_capture"}]
    # observation["board"]: list[81] → None hoặc {"player": 1|2, "type": "ROCK"|"PAPER"|"SCISSORS"}
    # observation["current_player"]: 1 hoặc 2
    # observation["piece_counts"]: {1: {ROCK:n, PAPER:n, SCISSORS:n}, 2: {...}}
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
app.include_router(matches_router)
app.include_router(tournament_router)
