# OTTv2 Tournament API

Backend Python quản lý trận đấu **Oẳn Tù Tì v2** giữa các agent AI, tương tự Kaggle ConnectX.

Luật chơi lấy trực tiếp từ repo gốc: [tuanngthuet/BT01INT3304](https://github.com/tuanngthuet/BT01INT3304)

---

## Mục lục

- [Tổng quan kiến trúc](#tổng-quan-kiến-trúc)
- [Luật chơi OTTv2](#luật-chơi-ottv2)
- [Cài đặt và chạy](#cài-đặt-và-chạy)
- [Cài đặt Judge0 bằng Docker](#cài-đặt-judge0-bằng-docker)
- [API Reference](#api-reference)
- [Viết agent](#viết-agent)
- [Kiểm thử](#kiểm-thử)
- [Tích hợp frontend Vercel](#tích-hợp-frontend-vercel)

---

## Tổng quan kiến trúc

```
Frontend (Vercel)
      │  HTTP/JSON
      ▼
FastAPI Backend (Ubuntu)
  ├── Match Service      ← quản lý vòng đời trận đấu (in-memory)
  ├── Game Engine        ← thuần Python, chính xác theo game.js
  └── Judge0 Service     ← sandbox thực thi agent code
            │
            ▼
      Judge0 (Docker)    ← Python 3 sandbox
```

**Workflow một nước đi:**
1. Frontend gọi `POST /matches/{id}/step`
2. Backend lấy observation (trạng thái bàn cờ, nước đi hợp lệ)
3. Gửi code agent + observation sang Judge0 qua HTTP
4. Judge0 thực thi Python trong sandbox, trả về nước đi (JSON)
5. Backend kiểm tra tính hợp lệ, áp dụng vào engine
6. Trả về kết quả cho frontend

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
- Docker + Docker Compose (cho Judge0)

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
# Chỉnh sửa .env nếu cần (mặc định là Judge0 localhost:2358)
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

## Cài đặt Judge0 bằng Docker

Judge0 là sandbox thực thi code an toàn. Cần chạy trước khi dùng `/step`.

### Cài đặt nhanh (Judge0 CE)

```bash
# Tải docker-compose của Judge0
wget https://github.com/judge0/judge0/releases/download/v1.13.1/judge0-v1.13.1.zip
unzip judge0-v1.13.1.zip
cd judge0-v1.13.1

# Tạo mật khẩu ngẫu nhiên cho Redis và Postgres
echo "REDIS_PASSWORD=$(openssl rand -hex 32)" >> judge0.conf
echo "POSTGRES_PASSWORD=$(openssl rand -hex 32)" >> judge0.conf

# Khởi động
docker-compose up -d db redis
sleep 10
docker-compose up -d
sleep 5

# Kiểm tra
curl http://localhost:2358/about
```

Judge0 sẽ chạy tại `http://localhost:2358`

### Xác nhận Python 3 có sẵn

```bash
# Lấy danh sách ngôn ngữ
curl http://localhost:2358/languages | python3 -m json.tool | grep -i python

# Python 3 thường có language_id = 71
# Nếu khác, cập nhật JUDGE0_LANGUAGE_ID trong .env
```

### Kiểm tra health

```bash
curl http://localhost:8000/health
# Kết quả mong đợi:
# {"status":"ok","judge0_connected":true,"judge0_url":"http://localhost:2358","version":"1.0.0"}
```

### Dùng Judge0 trên RapidAPI (không cần Docker)

Nếu không muốn cài Docker, dùng [Judge0 Extra CE trên RapidAPI](https://rapidapi.com/judge0-official/api/judge0-extra-ce):

```env
JUDGE0_URL=https://judge0-extra-ce.p.rapidapi.com
JUDGE0_API_KEY=your_rapidapi_key_here
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
- Agent chạy trong sandbox Judge0 với giới hạn CPU và RAM
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

# Chỉ engine tests (không cần Judge0)
python3 -m pytest tests/test_engine.py -v

# Chỉ API tests (không cần Judge0 thật, dùng mock)
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
│   │   ├── judge0_service.py # Thực thi agent qua Judge0
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
- **Judge0 timeout**: Mỗi nước đi ~1-2 giây (round-trip Judge0). Với trận 500 nước ≈ 15 phút.
- **Rate limiting**: Nên thêm rate limiter để tránh abuse `/run` endpoint.
- **Agent security**: Judge0 đã sandbox code. Không cần validate thêm ở backend.
