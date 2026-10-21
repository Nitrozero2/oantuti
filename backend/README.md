# OTTv2 Tournament API

Backend Python quản lý trận đấu **Oẳn Tù Tì v2** giữa các agent AI, tương tự Kaggle ConnectX.

Luật chơi lấy trực tiếp từ repo gốc: [tuanngthuet/BT01INT3304](https://github.com/tuanngthuet/BT01INT3304)

---

## Mục lục

- [Tổng quan kiến trúc](#tổng-quan-kiến-trúc)
- [Luật chơi OTTv2](#luật-chơi-ottv2)
- [Cài đặt và chạy](#cài-đặt-và-chạy)
- [Chạy Python worker](#chạy-python-worker)
- [API Reference](#api-reference)
- [Viết agent](#viết-agent)
- [Kiểm thử](#kiểm-thử)
- [Tích hợp frontend Vercel](#tích-hợp-frontend-vercel)

---

## Tổng quan kiến trúc

```text
Frontend Next.js ── FastAPI backend ── Redis queue
        ▲                                  │
        │ callback                         ▼
        └──────────────────── Python worker (Docker)
                              Engine + Bubblewrap sandbox
```

Backend xác thực và quản lý queue/lease. Worker nhận một trận, chạy engine cùng
Python agents trong sandbox rồi gửi kết quả/replay về frontend. Backend không
thực thi code agent và không kết nối dịch vụ thực thi HTTP.

---

## Luật chơi OTTv2

*(Trích xuất trực tiếp từ `game.js`)*

| Thành phần | Chi tiết |
|---|---|
| Bàn cờ | 9×9, cột a–i (0–8), hàng 1–9 (0–8) |
| Quân cờ | ROCK ✊ thắng SCISSORS, PAPER ✋ thắng ROCK, SCISSORS ✌️ thắng PAPER |
| Di chuyển | 8 hướng kiểu Vua cờ vua, 1 ô mỗi bước |
| Ăn quân | Chỉ ăn được quân yếu hơn; cùng loại không ăn nhau |
| P1 ban đầu | SCISSORS: 5c 4d 3e · PAPER: 5b 4c 3d 2e · ROCK: 4b 3c 2d |
| P2 ban đầu | SCISSORS: 7e 6f 5g · PAPER: 8e 7f 6g 5h · ROCK: 8f 7g 6h |
| Thắng | P1 chiếm **i9**, P2 chiếm **a1**, hoặc tiêu diệt hết 1 loại quân đối thủ |

---

## Cài đặt và chạy

### 1. Yêu cầu

- Ubuntu 20.04+
- Python 3.10+
- Docker Engine + Docker Compose (cho Python worker)

### 2. Clone và cài đặt

```bash
cd ottv2-backend

# Tạo virtualenv
python3 -m venv venv
source venv/bin/activate

# Cài dependencies
pip install -r requirements.txt
```

### 3. Cấu hình môi trường

```bash
cp .env.example .env
# Điền Redis URL/token và worker/internal secrets
```

### 4. Khởi động server

```bash
# Development (với auto-reload)
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Production
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

API sẽ chạy tại `http://localhost:8000`
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

---

## Chạy Python worker

Từ repository root, điền `worker_image/.env` rồi chạy:

```bash
./dockerworker.sh
./dockerworker.sh logs
./dockerworker.sh stop
```

Worker dùng một image chứa engine, supervisor và Python sandbox. Mỗi lượt có giới
hạn CPU, wall time, memory và output. Hướng dẫn đầy đủ ở
[worker_image/README.md](../worker_image/README.md). Runner chung kết là chương trình
độc lập, không thay đổi theo cấu hình worker chính.

Health API phản ánh kết nối Redis:

```bash
curl http://localhost:8000/health
# {"status":"ok","redis_connected":true,"version":"2.0.0"}
```

---

## API Reference

### Tạo trận đấu

```bash
POST /matches/
Content-Type: application/json

{
  "agent1_code": "...",  # Mã Python của Player 1
  "agent2_code": "...",  # Mã Python của Player 2
  "max_moves": 500       # Tùy chọn, mặc định 500
}

# Response:
{
  "match_id": "a1b2c3d4",
  "status": "running",
  "message": "..."
}
```

### Lấy trạng thái trận đấu

```bash
GET /matches/{match_id}

# Response:
{
  "match_id": "a1b2c3d4",
  "status": "running",
  "current_turn": 1,
  "move_count": 5,
  "game_over": false,
  "winner": null,
  "board": [[...], ...],       # 9x9, mỗi ô: null hoặc {"player":1,"type":"ROCK"}
  "piece_counts": {
    "1": {"ROCK": 3, "PAPER": 4, "SCISSORS": 3},
    "2": {"ROCK": 3, "PAPER": 4, "SCISSORS": 3}
  },
  "valid_moves": [
    {"from_col": 1, "from_row": 3, "to_col": 0, "to_row": 3, "is_capture": false},
    ...
  ],
  "history": [...]
}
```

### Thực hiện 1 nước đi (recommended cho frontend)

```bash
POST /matches/{match_id}/step

# Response:
{
  "match_id": "a1b2c3d4",
  "step_number": 6,
  "player": 1,
  "move": {"from_col": 1, "from_row": 3, "to_col": 0, "to_row": 3, "from_pos": "b4", "to_pos": "a4"},
  "captured": null,
  "game_over": false,
  "winner": null,
  "win_reason": "",
  "error": null,
  "agent_stdout": "..."
}
```

### Chạy đến khi kết thúc

```bash
POST /matches/{match_id}/run

# Response:
{
  "match_id": "a1b2c3d4",
  "total_moves": 42,
  "game_over": true,
  "winner": 1,
  "win_reason": "Người chơi 1 đưa quân ROCK chiếm căn cứ i9!",
  "steps": [...]
}
```

### Danh sách trận đấu

```bash
GET /matches/
```

### Xóa trận đấu

```bash
DELETE /matches/{match_id}
```

---

## Viết agent

Agent là **hàm Python** với signature cố định:

```python
def agent(observation, configuration):
    """
    Args:
        observation (dict):
            board (list[81]):
                Bàn cờ phẳng, row-major (board[row*9 + col]).
                Mỗi phần tử: None hoặc {"player": 1|2, "type": "ROCK"|"PAPER"|"SCISSORS"}
            board_2d (list[9][9]):
                Bàn cờ 2 chiều, board_2d[row][col]
            current_player (int): 1 hoặc 2
            valid_moves (list):
                [{"from_col":int, "from_row":int, "to_col":int, "to_row":int, "is_capture":bool}, ...]
            piece_counts (dict):
                {1: {"ROCK":3, "PAPER":4, "SCISSORS":3}, 2: {...}}
            move_count (int): tổng số nước đã đi
        configuration (dict): {} (hiện tại rỗng)

    Returns:
        dict: {"from_col": int, "from_row": int, "to_col": int, "to_row": int}
        hoặc None (resign - đối thủ thắng)
    """
    pass
```

**Lưu ý quan trọng:**
- Agent chạy trong Python sandbox Bubblewrap với giới hạn CPU và RAM
- Import chỉ được dùng thư viện standard library (không có numpy, pandas, etc.)
- Không đọc/ghi file, không gọi mạng
- Timeout mặc định: 10 giây

### Agent mẫu: Random

```python
import random

def agent(observation, configuration):
    moves = observation.get("valid_moves", [])
    if not moves:
        return None
    move = random.choice(moves)
    return {
        "from_col": move["from_col"],
        "from_row": move["from_row"],
        "to_col": move["to_col"],
        "to_row": move["to_row"],
    }
```

### Test với curl

```bash
# Đọc code agent từ file và test
AGENT_CODE=$(python3 -c "
import json
with open('agents/random_agent.py') as f:
    print(json.dumps(f.read()))
")

curl -X POST http://localhost:8000/matches/ \
  -H "Content-Type: application/json" \
  -d "{\"agent1_code\": $AGENT_CODE, \"agent2_code\": $AGENT_CODE}" \
  | python3 -m json.tool
```

---

## Kiểm thử

```bash
# Chạy tất cả tests
python3 -m pytest tests/ -v

# Chỉ engine tests (không cần sandbox)
python3 -m pytest tests/test_engine.py -v

# Chỉ API tests (dùng mock Redis và thực thi agent)
python3 -m pytest tests/test_api.py -v

# Với coverage
pip install pytest-cov
python3 -m pytest tests/ --cov=app --cov-report=term-missing
```

Kết quả mong đợi: **63 engine tests + 20 API tests = 83 tests passed**

---

## Cấu trúc file

```
ottv2-backend/
├── app/
│   ├── main.py              # FastAPI entry point
│   ├── config.py            # Cấu hình từ .env
│   ├── models.py            # Pydantic request/response models
│   ├── engine/
│   │   └── game.py          # Game engine (chuyển dịch từ game.js)
│   ├── services/
│   │   └── match_service.py  # Quản lý trận đấu
│   └── routers/
│       ├── matches.py        # /matches endpoints
│       └── health.py         # /health endpoint
├── agents/
│   ├── random_agent.py       # Agent random (để test)
│   └── greedy_agent.py       # Agent tham lam
├── tests/
│   ├── test_engine.py        # 63 unit tests cho game engine
│   └── test_api.py           # 20 integration tests cho API
├── .env.example
├── requirements.txt
└── README.md
```

---

## Tích hợp frontend Vercel

Frontend có thể tích hợp với API qua các bước:

### 1. Thiết lập CORS

Trong `.env`:
```env
CORS_ORIGINS=["https://your-app.vercel.app", "http://localhost:3000"]
```

### 2. Luồng thi đấu từ frontend

```javascript
// 1. Tạo trận
const { match_id } = await fetch('/matches', {
  method: 'POST',
  body: JSON.stringify({ agent1_code, agent2_code })
}).then(r => r.json());

// 2. Lặp từng nước đến khi game_over
while (true) {
  const step = await fetch(`/matches/${match_id}/step`, { method: 'POST' })
    .then(r => r.json());

  renderBoard(step);  // Cập nhật UI

  if (step.game_over) {
    showResult(step.winner, step.win_reason);
    break;
  }

  await sleep(500);  // Chờ animation
}

// 3. (Tùy chọn) Lấy toàn bộ state
const state = await fetch(`/matches/${match_id}`).then(r => r.json());
```

### 3. Deploy backend lên Ubuntu server

```bash
# Cài gunicorn
pip install gunicorn

# Chạy với gunicorn + uvicorn worker
gunicorn app.main:app \
  -w 4 \
  -k uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000

# Hoặc dùng systemd service (khuyến nghị production)
```

---

## Lưu ý triển khai

- **Lưu trữ in-memory**: Match data lưu trong RAM, mất khi restart. Để production, thay bằng Redis.
- **Giới hạn mỗi lượt**: Worker áp dụng CPU, wall time, memory và output theo cấu hình `AGENT_*`.
- **Rate limiting**: Nên thêm rate limiter để tránh abuse `/run` endpoint.
- **Agent execution**: Chỉ worker Python thực thi code trong Bubblewrap; engine vẫn kiểm tra từng nước đi.
