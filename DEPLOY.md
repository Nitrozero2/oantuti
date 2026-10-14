# Hướng dẫn Deploy — OTTv2 (Redis Queue + Worker)

## Kiến trúc

```
Người dùng (browser)
        │
        ▼
┌──────────────────┐
│  Frontend        │  Vercel (Next.js)
│  /api/...        │  ← Auth, DB, bảng xếp hạng
└────────┬─────────┘
         │ HTTPS
         ▼
┌──────────────────┐
│  FastAPI         │  Vercel Serverless
│  /matches        │  ← Tạo job, quản lý state
│  /jobs           │
└────────┬─────────┘
         │ Upstash REST API
         ▼
┌──────────────────┐
│  Redis           │  Upstash (luôn online)
│  job queue       │  ← Queue, match state, heartbeat
│  match state     │
└────────┬─────────┘
         │ poll qua HTTPS (outbound)
         ▼
┌──────────────────┐
│  Worker          │  Máy cá nhân
│  worker.py       │  ← Nhận job, chạy Judge0
└────────┬─────────┘
         │ localhost
         ▼
┌──────────────────┐
│  Judge0          │  Docker (máy cá nhân)
│  :2358           │  ← Sandbox thực thi Python
└──────────────────┘
         │
┌──────────────────┐
│  Neon PostgreSQL │  Serverless (luôn online)
└──────────────────┘
```

**Ưu điểm so với kiến trúc cũ:**
- Không cần Cloudflare Tunnel
- FastAPI serverless trên Vercel, không cần máy chạy liên tục
- Worker chỉ cần kết nối **outbound** — không cần mở port inbound
- Thêm máy worker mới không cần sửa code

---

## Phần 1: Test local (làm trước)

Test toàn bộ trên máy local trước khi deploy Vercel.

### Bước 1: Setup lần đầu

```bash
cd /home/tuan/Oantuti
./setup.sh
```

Script sẽ tạo venv cho backend và worker, cài npm cho frontend.

### Bước 2: Điền biến môi trường

**`backend/.env`** — đã được tạo từ `.env.example`:
```env
UPSTASH_REDIS_REST_URL=https://factual-stingray-170088.upstash.io
UPSTASH_REDIS_REST_TOKEN=<token>
WORKER_SECRET=my-local-secret
JUDGE0_URL=http://localhost:2358
```

**`worker/.env`** — tạo từ `.env.example`:
```bash
cp worker/.env.example worker/.env
```
```env
BACKEND_URL=http://localhost:8000
WORKER_SECRET=my-local-secret     # phải khớp với backend
JUDGE0_URL=http://localhost:2358
MAX_CONCURRENT=2
```

**`Frontend/.env.local`**:
```env
DATABASE_URL=postgresql://...neon.tech/...
SESSION_SECRET=<random string>
BACKEND_URL=http://localhost:8000
```

### Bước 3: Khởi động Judge0

```bash
cd judge0 && docker compose up -d
# Chờ ~30s rồi kiểm tra:
curl http://localhost:2358/about
```

### Bước 4: Khởi động tất cả (dev mode)

```bash
./dev.sh
```

Sẽ mở 3 terminal:
- **OTTv2 Backend** — uvicorn với hot-reload tại `:8000`
- **OTTv2 Worker** — python worker.py, poll Redis
- **OTTv2 Frontend** — npm run dev tại `:3000`

### Bước 5: Kiểm tra

```bash
# 1. Backend health
curl http://localhost:8000/health
# → {"status":"ok","redis_connected":true,"version":"1.0.0"}

# 2. Tạo match
curl -X POST http://localhost:8000/matches/ \
  -H "Content-Type: application/json" \
  -d '{
    "agent1_code": "import random\ndef agent(obs, cfg): return random.choice(obs[\"valid_moves\"])",
    "agent2_code": "import random\ndef agent(obs, cfg): return random.choice(obs[\"valid_moves\"])"
  }'
# → {"match_id":"abc123","status":"running","message":"..."}

# 3. Enqueue nước đi
curl -X POST http://localhost:8000/matches/abc123/step
# → {"match_id":"abc123","job_id":"uuid...","status":"queued","message":"..."}

# 4. Poll job (chờ worker chạy, ~2-5s)
curl http://localhost:8000/jobs/<job_id>
# → {"status":"completed","result":{"success":true,"move":{...},...}}

# 5. Apply nước đi
curl -X POST http://localhost:8000/matches/abc123/apply-job \
  -H "Content-Type: application/json" \
  -d '{"job_id":"<job_id>"}'
# → StepResult với move, game_over, ...

# 6. Worker status
curl http://localhost:8000/workers/status
# → {"workers":[{"worker_id":"hostname","active_jobs":0,...}],"queue_depth":0}
```

### Bước 6: Test từ Frontend

Mở `http://localhost:3000`, đăng nhập, vào Arena → tạo trận friendly.

Lưu ý: Frontend (`/api/friendly/live`) hiện vẫn dùng flow cũ (`/matches/{id}/step` blocking). Nếu chỉ test backend + worker thì dùng `curl` ở Bước 5 là đủ.

---

## Phần 2: Deploy FastAPI lên Vercel

Sau khi test local thành công.

### Bước 1: Cài Vercel CLI

```bash
npm install -g vercel
```

### Bước 2: Deploy backend

```bash
cd backend
vercel deploy --prod
```

Vercel sẽ hỏi:
- **Set up and deploy?** → Y
- **Which scope?** → chọn account của bạn
- **Link to existing project?** → N (lần đầu)
- **Project name?** → `ottv2-backend` (hoặc tên bất kỳ)
- **In which directory?** → `.` (thư mục backend)

### Bước 3: Cấu hình Environment Variables

Vào **Vercel Dashboard → Project → Settings → Environment Variables**:

| Key | Value |
|-----|-------|
| `UPSTASH_REDIS_REST_URL` | `https://factual-stingray-170088.upstash.io` |
| `UPSTASH_REDIS_REST_TOKEN` | `<token từ Upstash>` |
| `WORKER_SECRET` | `<openssl rand -hex 32>` |
| `CORS_ORIGINS` | `["https://your-frontend.vercel.app"]` |
| `JOB_TTL_SECONDS` | `3600` |
| `MATCH_TTL_SECONDS` | `86400` |

> `JUDGE0_URL` không cần trên Vercel — backend không gọi Judge0 trực tiếp.

### Bước 4: Kiểm tra

```bash
curl https://your-backend.vercel.app/health
# → {"status":"ok","redis_connected":true}
```

---

## Phần 3: Deploy Frontend lên Vercel

### Bước 1: Deploy

```bash
cd Frontend
vercel deploy --prod
```

### Bước 2: Environment Variables

| Key | Value |
|-----|-------|
| `DATABASE_URL` | `postgresql://...neon.tech/...` |
| `SESSION_SECRET` | `<random 32+ chars>` |
| `BACKEND_URL` | `https://your-backend.vercel.app` |

### Bước 3: Redeploy sau khi set env

```bash
vercel deploy --prod --force
```

---

## Phần 4: Chạy Worker trên máy có Judge0

### Lần đầu

```bash
cd worker
cp .env.example .env
nano .env
```

```env
BACKEND_URL=https://your-backend.vercel.app
WORKER_SECRET=<khớp với WORKER_SECRET trên Vercel>
JUDGE0_URL=http://localhost:2358
MAX_CONCURRENT=2
WORKER_ID=my-machine-01   # tùy chọn, mặc định = hostname
```

```bash
source venv/bin/activate
python worker.py
```

### Chạy nền (khuyên dùng khi production)

```bash
./start.sh   # khởi động cả Judge0 + Backend (nếu cần local) + Worker
```

Hoặc chỉ khởi động worker:
```bash
cd worker && source venv/bin/activate && nohup python worker.py >> ../logs/worker.log 2>&1 &
```

### Xem log worker

```bash
tail -f logs/worker.log
```

Log bình thường:
```
2026-10-14 [INFO] worker: Worker my-machine-01 starting...
2026-10-14 [INFO] worker:   Backend: https://your-backend.vercel.app
2026-10-14 [INFO] worker:   Judge0:  http://localhost:2358
2026-10-14 [INFO] worker: Claimed job abc-123 (match=935c, player=1)
2026-10-14 [INFO] worker: Job abc-123 completed successfully, move={'from_col':4,...}
```

---

## Phần 5: Thêm máy worker mới

Không cần sửa code backend hay frontend:

1. Copy thư mục `worker/` sang máy mới
2. Tạo `worker/.env` với cùng `BACKEND_URL` và `WORKER_SECRET`
3. Đặt `WORKER_ID` khác nhau (ví dụ `host-02`)
4. Cài Judge0 Docker trên máy mới
5. Chạy `python worker.py`

Worker mới tự poll cùng Redis queue và nhận job.

---

## Phần 6: Dừng và khởi động lại

```bash
# Dừng tất cả
./stop.sh

# Khởi động lại
./start.sh

# Chỉ dừng worker
kill $(cat logs/worker.pid)

# Chỉ dừng backend local
kill $(cat logs/backend.pid)
```

---

## Phần 7: Debug thường gặp

### Worker không nhận job

```bash
# Kiểm tra kết nối backend
curl https://your-backend.vercel.app/health

# Kiểm tra worker secret khớp không
grep WORKER_SECRET worker/.env
grep WORKER_SECRET backend/.env

# Kiểm tra Judge0
curl http://localhost:2358/about
```

### Redis không kết nối

```bash
cd backend && python3 -c "
import asyncio
from dotenv import load_dotenv; load_dotenv('.env')
from app.redis_client import get_redis
async def t():
    r = get_redis()
    print('PING:', await r.ping())
asyncio.run(t())
"
```

### Job stuck ở trạng thái `queued`

Worker chưa chạy hoặc đang crash. Kiểm tra:
```bash
tail -f logs/worker.log
# Nếu không có log → worker chưa khởi động
```

### Job stuck ở trạng thái `claimed` mãi không complete

Worker đã claim nhưng crash trước khi xong. Job sẽ tự hết hạn sau `JOB_TTL_SECONDS` (mặc định 1 giờ). Restart worker.

---

## Tóm tắt file `.env` cho từng môi trường

### Test local

| File | Biến | Giá trị |
|------|------|---------|
| `backend/.env` | `UPSTASH_REDIS_REST_URL` | URL Upstash |
| | `UPSTASH_REDIS_REST_TOKEN` | Token Upstash |
| | `WORKER_SECRET` | bất kỳ (vd: `local-secret`) |
| | `JUDGE0_URL` | `http://localhost:2358` |
| `worker/.env` | `BACKEND_URL` | `http://localhost:8000` |
| | `WORKER_SECRET` | phải khớp backend |
| | `JUDGE0_URL` | `http://localhost:2358` |
| `Frontend/.env.local` | `DATABASE_URL` | Neon URL |
| | `BACKEND_URL` | `http://localhost:8000` |

### Production

| File | Biến | Giá trị |
|------|------|---------|
| Vercel Backend | `UPSTASH_REDIS_REST_URL` | URL Upstash |
| | `UPSTASH_REDIS_REST_TOKEN` | Token Upstash |
| | `WORKER_SECRET` | openssl rand -hex 32 |
| | `CORS_ORIGINS` | `["https://your-frontend.vercel.app"]` |
| Vercel Frontend | `DATABASE_URL` | Neon URL |
| | `SESSION_SECRET` | random 32+ chars |
| | `BACKEND_URL` | `https://your-backend.vercel.app` |
| `worker/.env` | `BACKEND_URL` | `https://your-backend.vercel.app` |
| | `WORKER_SECRET` | khớp Vercel backend |
