# Hướng dẫn Deploy — Kiến trúc Phân tán

## Tổng quan

```
Frontend (Vercel/Next.js)
    ↕ HTTPS
FastAPI (Vercel Serverless)
    ↕ Upstash REST API
Redis Queue (Upstash)
    ↕ Poll qua HTTPS
Worker (máy local có Judge0)
    ↓
Judge0 (Docker, localhost)
```

---

## 1. Upstash Redis (đã có)

Đã cấu hình:
- URL: `https://factual-stingray-170088.upstash.io`
- Token đã điền trong `backend/.env`

**Không commit `.env` lên git.** Dùng Vercel Environment Variables thay thế.

---

## 2. Deploy FastAPI lên Vercel

### Chuẩn bị

```bash
cd backend
# Đảm bảo vercel.json và api/index.py tồn tại
ls vercel.json api/index.py
```

### Deploy lần đầu

```bash
cd backend
npx vercel deploy --prod
```

Vercel sẽ hỏi project name và settings. Chọn defaults, không override build command.

### Cấu hình Environment Variables trên Vercel

Vào **Vercel Dashboard → Project → Settings → Environment Variables**, thêm:

| Key | Value |
|-----|-------|
| `UPSTASH_REDIS_REST_URL` | `https://factual-stingray-170088.upstash.io` |
| `UPSTASH_REDIS_REST_TOKEN` | (token từ Upstash) |
| `WORKER_SECRET` | (một chuỗi ngẫu nhiên, ví dụ: `openssl rand -hex 32`) |
| `CORS_ORIGINS` | `["https://your-frontend.vercel.app"]` |
| `MAX_MOVES_PER_MATCH` | `500` |
| `JOB_TTL_SECONDS` | `3600` |
| `MATCH_TTL_SECONDS` | `86400` |

> `JUDGE0_URL` không cần thiết trên Vercel — FastAPI chỉ quản lý queue, không gọi Judge0 trực tiếp nữa.

### Kiểm tra sau deploy

```bash
curl https://your-backend.vercel.app/health
# Kỳ vọng: {"status":"ok","redis_connected":true,"version":"1.0.0"}
```

---

## 3. Chạy Worker trên máy có Judge0

### Cài đặt lần đầu

```bash
cd worker
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Cấu hình

```bash
cp .env.example .env
nano .env
```

Điền:
```env
BACKEND_URL=https://your-backend.vercel.app
WORKER_SECRET=<khớp với WORKER_SECRET trên Vercel>
JUDGE0_URL=http://localhost:2358
MAX_CONCURRENT=2
```

### Khởi động

```bash
source venv/bin/activate
python worker.py
```

Log bình thường:
```
Worker my-host starting...
  Backend: https://your-backend.vercel.app
  Judge0:  http://localhost:2358
  Max concurrent: 2
```

### Chạy nền với systemd (Linux)

Tạo file `/etc/systemd/system/ottv2-worker.service`:

```ini
[Unit]
Description=OTTv2 Worker
After=network.target

[Service]
Type=simple
User=<your-user>
WorkingDirectory=/path/to/Oantuti/worker
EnvironmentFile=/path/to/Oantuti/worker/.env
ExecStart=/path/to/Oantuti/worker/venv/bin/python worker.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable ottv2-worker
sudo systemctl start ottv2-worker
sudo journalctl -u ottv2-worker -f  # xem log
```

---

## 4. Cập nhật Frontend

Frontend cần cập nhật để dùng flow async mới.

### Flow mới cho `friendly/live`

Thay vì loop `POST /matches/{id}/step` (blocking), giờ phải:

```typescript
// 1. Tạo match
const { match_id } = await backendFetch('/matches/', { method: 'POST', body: ... })

// 2. Loop cho đến game_over
while (!gameOver) {
  // 2a. Enqueue step
  const { job_id } = await backendFetch(`/matches/${match_id}/step`, { method: 'POST' })

  // 2b. Poll job
  let job
  while (true) {
    job = await backendFetch(`/jobs/${job_id}`)
    if (job.status === 'completed' || job.status === 'failed') break
    await sleep(1000)
  }

  // 2c. Apply result
  const stepResult = await backendFetch(`/matches/${match_id}/apply-job`, {
    method: 'POST',
    body: JSON.stringify({ job_id })
  })

  gameOver = stepResult.game_over
}
```

> **Lưu ý Vercel Hobby timeout 30s:** Mỗi request phải xong trong 30s.
> - `POST /matches/{id}/step` → trả về ngay (~100ms)
> - `GET /jobs/{job_id}` → trả về ngay (~100ms)
> - `POST /matches/{id}/apply-job` → trả về ngay (~200ms)
> - Chỉ Worker mới blocking khi chờ Judge0

### Cập nhật `lib/api.ts` hoặc `lib/backend.ts`

Thêm các hàm:
- `stepMatchAsync(matchId)` → `{ job_id }`
- `pollJob(jobId)` → `{ status, result }`
- `applyJob(matchId, jobId)` → `StepResult`

---

## 5. Thêm host Worker mới

Không cần sửa backend hay frontend. Chỉ cần:

1. Cài Judge0 trên máy mới
2. Copy thư mục `worker/` sang máy mới
3. Tạo `.env` với `BACKEND_URL` và `WORKER_SECRET` giống nhau
4. Đặt `WORKER_ID` khác nhau (ví dụ `host-02`)
5. Chạy `python worker.py`

Worker mới sẽ tự poll cùng Redis queue và nhận job.

---

## 6. Kiểm tra và debug

### Xem queue depth

```bash
curl https://your-backend.vercel.app/tournament/status
```

### Xem trạng thái job

```bash
curl https://your-backend.vercel.app/jobs/<job_id>
```

### Xem log worker

```bash
tail -f /var/log/ottv2-worker.log
# hoặc nếu chạy tay:
python worker.py 2>&1 | tee worker.log
```

### Worker không nhận job?

1. Kiểm tra `WORKER_SECRET` khớp với backend
2. Kiểm tra `BACKEND_URL` đúng và accessible
3. Kiểm tra Judge0: `curl http://localhost:2358/about`
4. Kiểm tra log worker cho lỗi cụ thể

### Job stuck ở trạng thái `claimed`?

Job bị claim nhưng worker crash → sau `JOB_TTL_SECONDS` job sẽ tự hết hạn trong Redis.
Worker mới sẽ không thấy job đó nữa → match sẽ timeout phía frontend.

Để handle tốt hơn: implement timeout scanning (TODO trong `job_service.py`).

---

## 7. Security checklist

- [ ] `WORKER_SECRET` phải đủ mạnh (dùng `openssl rand -hex 32`)
- [ ] Không commit `.env` lên git (đã có trong `.gitignore`)
- [ ] `CORS_ORIGINS` trên Vercel chỉ cho phép domain frontend
- [ ] Upstash token không expose ra frontend
- [ ] Judge0 chỉ accessible từ localhost (không mở port ra ngoài)
- [ ] Worker không cần inbound port — chỉ kết nối outbound

---

## 8. Sơ đồ luồng đầy đủ

```
Frontend                FastAPI/Vercel           Redis            Worker         Judge0
   |                         |                     |                |               |
   |-- POST /matches ------->|                     |                |               |
   |<-- {match_id} ----------|                     |                |               |
   |                         |                     |                |               |
   |-- POST /matches/        |                     |                |               |
   |      {id}/step -------->|                     |                |               |
   |                         |-- save job -------->|                |               |
   |                         |-- LPUSH queue ----->|                |               |
   |<-- {job_id, queued} ----|                     |                |               |
   |                         |                     |                |               |
   |                         |                     |<-- RPOP -------|               |
   |                         |                     |-- job data --->|               |
   |                         |                     |                |-- submit ---->|
   |                         |                     |                |<-- result ----|
   |                         |                     |                |               |
   |-- GET /jobs/{job_id} -->|                     |                |               |
   |                         |<-- load job --------|                |               |
   |<-- {status: queued} ----|    (still queued)   |                |               |
   |  (poll lại sau 1s)      |                     |                |               |
   |                         |                     |<-- complete ---|               |
   |                         |                     |-- job updated->|               |
   |-- GET /jobs/{job_id} -->|                     |                |               |
   |                         |<-- load job --------|                |               |
   |<-- {status:completed} --|                     |                |               |
   |                         |                     |                |               |
   |-- POST /matches/        |                     |                |               |
   |      {id}/apply-job --->|                     |                |               |
   |                         |-- load job + match->|                |               |
   |                         |-- apply move        |                |               |
   |                         |-- save match ------>|                |               |
   |<-- StepResult ----------|                     |                |               |
```
